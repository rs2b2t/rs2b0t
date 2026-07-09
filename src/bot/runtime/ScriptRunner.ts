import type { AbstractBot } from '../api/Bot.js';
import { RandomEvents } from '../api/RandomEvents.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { RecoveryHints } from './RecoveryHints.js';
import { Scheduler } from './Scheduler.js';
import { ScriptAborted, ScriptContext } from './ScriptContext.js';
import type { ScriptMeta } from './ScriptRegistry.js';
import { SettingsBag, SettingsStore } from './Settings.js';
import { Supervisor } from './Supervisor.js';

/**
 * Lifecycle of the (single) active script run.
 *
 * Stop = abort: every pending Execution.* promise rejects ScriptAborted, the
 * await chain unwinds through the script's own finally blocks, then onStop()
 * runs. Pause = the pump stops resolving waiters (and the clock shift on
 * resume means paused time never counts toward delays/timeouts).
 */
class ScriptRunnerImpl {
    ctx: ScriptContext | null = null;
    bot: AbstractBot | null = null;
    meta: ScriptMeta | null = null;

    private changeListeners = new Set<() => void>();

    constructor() {
        Scheduler.launchLoop = ctx => this.launchIteration(ctx);
    }

    get state(): string {
        return this.ctx?.state ?? 'idle';
    }

    start(meta: ScriptMeta): void {
        if (this.ctx && (this.ctx.state === 'running' || this.ctx.state === 'paused' || this.ctx.state === 'stopping')) {
            throw new Error(`'${this.meta?.name}' is still ${this.ctx.state}`);
        }

        const ctx = new ScriptContext();
        const bot = meta.create();
        bot.bindLog(msg => ctx.addLog('info', msg));
        // resolve this run's parameters (schema default <- saved <- URL)
        if (meta.settingsSchema) {
            bot.settings = new SettingsBag(SettingsStore.resolve(meta.name, meta.settingsSchema));
        }

        this.ctx = ctx;
        this.bot = bot;
        this.meta = meta;
        Scheduler.active = ctx;

        // wire this run's failure log sink into the router (direct-only)
        ActionRouter.beginRun((level, msg) => ctx.addLog(level, msg));

        ctx.addLog('info', `${meta.name} started (input: ${ActionRouter.driver.mode})`);
        this.fireChange();

        // onStart runs as iteration zero: loop() won't launch until it settles
        ctx.loopInFlight = true;
        (async () => {
            await bot.onStart?.();
        })()
            .then(() => {
                RandomEvents.setGrindTargets(bot.grindTargets());
                RandomEvents.setLampSkill(SettingsStore.globalBag().str('lampSkill', 'strength'));
                Supervisor.resetProgress();
                // A recovery hint still set after onStart means this script never
                // consumed it (only anchored scripts call RecoveryHints.takeAnchor),
                // so clear it before it can leak into a later run. A consumer already
                // flipped pendingRecovery=false via takeAnchor and re-registered its
                // anchor for the next watchdog restart, so this is a no-op for them.
                if (RecoveryHints.pendingRecovery) {
                    RecoveryHints.clear();
                }
                ctx.loopInFlight = false;
                ctx.nextLoopAt = 0;
                ctx.progress();
            })
            .catch(err => this.settleFailure(ctx, err));
    }

    pause(): void {
        const { ctx, bot } = this;
        if (!ctx || ctx.state !== 'running') {
            return;
        }

        ctx.pause();
        try {
            bot?.onPause?.();
        } catch (err) {
            ctx.addLog('warn', `onPause threw: ${err}`);
        }
        ctx.addLog('info', 'paused');
        this.fireChange();
    }

    resume(): void {
        const { ctx, bot } = this;
        if (!ctx || ctx.state !== 'paused') {
            return;
        }

        ctx.resume();
        try {
            bot?.onResume?.();
        } catch (err) {
            ctx.addLog('warn', `onResume threw: ${err}`);
        }
        ctx.addLog('info', 'resumed');
        this.fireChange();
    }

    stop(): void {
        const ctx = this.ctx;
        if (!ctx || ctx.state === 'stopped' || ctx.state === 'crashed') {
            return;
        }

        if (ctx.state === 'stopping') {
            return;
        }

        ctx.state = 'stopping';
        ctx.addLog('info', 'stopping...');
        this.fireChange();
        ctx.abortWaiters();

        // if no iteration is in flight the abort has nothing to unwind
        if (!ctx.loopInFlight) {
            this.finishStop(ctx);
        }
        // otherwise the in-flight loop promise settles (usually with
        // ScriptAborted) and settleFailure/iteration-then finishes the stop
    }

    /** Panel subscription for state transitions. */
    onChange(cb: () => void): () => void {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    }

    private launchIteration(ctx: ScriptContext): void {
        const bot = this.bot;
        if (!bot || ctx !== this.ctx) {
            return;
        }

        const takeover = Supervisor.intercept(ctx, bot);

        ctx.loopInFlight = true;
        (async (): Promise<number | void> => {
            if (takeover) {
                await takeover.run();
                return; // supervisor iterations re-schedule at a fixed cadence
            }
            return (bot as AbstractBot & { loop(): number | void | Promise<number | void> }).loop();
        })()
            .then(delay => {
                ctx.loopInFlight = false;
                ctx.loopCount++;
                ctx.progress();

                if (ctx.state === 'stopping') {
                    this.finishStop(ctx);
                    return;
                }

                ctx.nextLoopAt = performance.now() + (takeover ? 600 : typeof delay === 'number' ? delay : bot.loopDelay);
            })
            .catch(err => this.settleFailure(ctx, err));
    }

    private settleFailure(ctx: ScriptContext, err: unknown): void {
        ctx.loopInFlight = false;

        if (err instanceof ScriptAborted || ctx.state === 'stopping') {
            this.finishStop(ctx);
            return;
        }

        // genuine script crash: isolate, report, tear down — the client and
        // panel keep running
        const error = err instanceof Error ? err : new Error(String(err));
        ctx.crashError = error;
        ctx.state = 'crashed';
        ctx.abortWaiters();
        ctx.addLog('error', `crashed: ${error.stack ?? error.message}`);
        console.error('[lcbuddy] script crashed', error);
        this.teardown(ctx);
    }

    private finishStop(ctx: ScriptContext): void {
        ctx.state = 'stopped';
        ctx.addLog('info', 'stopped');
        this.teardown(ctx);
    }

    private teardown(ctx: ScriptContext): void {
        try {
            this.bot?.onStop?.();
        } catch (err) {
            ctx.addLog('warn', `onStop threw: ${err}`);
        }

        // cancel in-flight synthetic gestures (releases held buttons/keys)
        // and restore the default input mode
        ActionRouter.endRun();

        this.bot?.disposeSubscriptions();

        if (Scheduler.active === ctx) {
            Scheduler.active = null;
        }
        this.fireChange();
    }

    private fireChange(): void {
        for (const listener of this.changeListeners) {
            try {
                listener();
            } catch (err) {
                console.error('[lcbuddy] runner listener error', err);
            }
        }
    }
}

export const ScriptRunner = new ScriptRunnerImpl();
