import { reader } from '../adapter/ClientAdapter.js';
import { resolveLoopCadence, type AbstractBot, type LoopCadence } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { RandomEvents } from '../api/RandomEvents.js';
import { Sustain } from '../api/Sustain.js';
import type { PaintFrame } from '../api/hud/Paint.js';
import { paintState } from '../api/hud/paintLogic.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { BotHost } from '../BotHost.js';
import { RecoveryHints } from './RecoveryHints.js';
import { Scheduler } from './Scheduler.js';
import { ScriptAborted, ScriptContext } from './ScriptContext.js';
import type { ScriptMeta } from './ScriptRegistry.js';
import { SettingsBag, SettingsStore } from './Settings.js';
import { Supervisor } from './Supervisor.js';

/** Schedule the next `loop()` according to the bot's cadence (see #427). */
function scheduleNextLoop(ctx: ScriptContext, cadence: LoopCadence): void {
    ctx.nextLoopAt = 0;
    ctx.nextLoopTick = 0;
    if (cadence.kind === 'frame') {
        // Eligible on the next Scheduler.pump (next client frame). nextLoopAt=0 is
        // already due; loopInFlight prevented re-entry during this iteration.
        return;
    }
    if (cadence.kind === 'server-tick') {
        const n = Math.max(1, cadence.ticks ?? 1);
        ctx.nextLoopTick = BotHost.tickCount + n;
        return;
    }
    ctx.nextLoopAt = performance.now() + Math.max(0, cadence.ms);
}

/**
 * Logged out (or mid scene load) the adapter serves stale or empty state, so a
 * script reading it draws wrong conclusions — a stale tile, a blank inventory.
 * Scripts only ever run behind this gate. With no client attached at all
 * (unit tests) there is no game state to protect and the gate stays out of
 * the way.
 */
function ingameOrDetached(): boolean {
    return !reader.attached() || (reader.ingame() && reader.sceneState() === 2 && reader.worldTile() !== null);
}

class ScriptRunnerImpl {
    ctx: ScriptContext | null = null;
    bot: AbstractBot | null = null;
    meta: ScriptMeta | null = null;

    private changeListeners = new Set<() => void>();
    private loggedOutSince = 0;

    constructor() {
        Scheduler.launchLoop = ctx => this.launchIteration(ctx);
    }

    paintControls(p: PaintFrame): void {
        const clicked = p.buttons([
            { id: 'pause', label: this.state === 'paused' ? 'Resume' : 'Pause' },
            { id: 'stop', label: 'Stop' }
        ]);
        if (clicked === 'pause') {
            if (this.state === 'paused') {
                this.resume();
            } else {
                this.pause();
            }
        } else if (clicked === 'stop') {
            this.stop();
        }
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
        if (meta.settingsSchema) {
            bot.settings = new SettingsBag(SettingsStore.resolve(meta.name, meta.settingsSchema));
        }

        this.ctx = ctx;
        this.bot = bot;
        this.meta = meta;
        Scheduler.active = ctx;

        ActionRouter.beginRun((level, msg) => ctx.addLog(level, msg));

        ctx.addLog('info', `${meta.name} started (input: ${ActionRouter.driver.mode})`);
        this.fireChange();

        this.loggedOutSince = 0;
        ctx.loopInFlight = true;
        (async () => {
            if (!ingameOrDetached()) {
                ctx.addLog('warn', 'not ingame — waiting for login before the script reads game state (auto-login kicks in if credentials are saved)');
                await Execution.delayUntil(ingameOrDetached, 0);
                ctx.addLog('info', 'ingame — starting');
            }
            await bot.onStart?.();
        })()
            .then(() => {
                ctx.loopInFlight = false;
                if (ctx.state === 'stopping') {
                    this.finishStop(ctx);
                    return;
                }

                RandomEvents.setGrindTargets(bot.grindTargets());
                RandomEvents.setLampSkill(SettingsStore.globalBag().str('lampSkill', 'strength'));
                Supervisor.resetProgress();
                if (RecoveryHints.pendingRecovery) {
                    RecoveryHints.clear();
                }
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

        if (!ctx.loopInFlight) {
            this.finishStop(ctx);
        }
    }

    onChange(cb: () => void): () => void {
        this.changeListeners.add(cb);
        return () => this.changeListeners.delete(cb);
    }

    private launchIteration(ctx: ScriptContext): void {
        const bot = this.bot;
        if (!bot || ctx !== this.ctx) {
            return;
        }

        if (!ingameOrDetached()) {
            if (this.loggedOutSince === 0) {
                this.loggedOutSince = performance.now();
                ctx.addLog('warn', 'logged out — holding the loop until back ingame');
            }
            // deliberate wait, not a stall: keep StallGuard from churn-restarting
            ctx.progress();
            // Wall-clock poll while logged out — no server ticks arrive.
            scheduleNextLoop(ctx, { kind: 'time', ms: 600 });
            return;
        }
        if (this.loggedOutSince > 0) {
            ctx.addLog('info', `back ingame after ${Math.round((performance.now() - this.loggedOutSince) / 1000)}s — resuming the loop`);
            this.loggedOutSince = 0;
        }

        const takeover = Supervisor.intercept(ctx, bot);

        ctx.loopInFlight = true;
        (async (): Promise<number | void> => {
            if (takeover) {
                await takeover.run();
                return;
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

                // Takeover / supervisor: one server tick between intercepts.
                // Numeric return from loop() keeps legacy wall-clock meaning only when
                // it is not the historical "600 = one tick" value (resolveLoopCadence).
                const cadence = takeover
                    ? ({ kind: 'server-tick', ticks: 1 } satisfies LoopCadence)
                    : typeof delay === 'number'
                      ? resolveLoopCadence(delay, null)
                      : resolveLoopCadence(bot.loopDelay, bot.loopCadence);
                scheduleNextLoop(ctx, cadence);
            })
            .catch(err => this.settleFailure(ctx, err));
    }

    private settleFailure(ctx: ScriptContext, err: unknown): void {
        ctx.loopInFlight = false;

        if (err instanceof ScriptAborted || ctx.state === 'stopping') {
            this.finishStop(ctx);
            return;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        ctx.crashError = error;
        ctx.state = 'crashed';
        ctx.abortWaiters();
        ctx.addLog('error', `crashed: ${error.stack ?? error.message}`);
        console.error('[rs2b0t] script crashed', error);
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

        Sustain.set(null);

        paintState.reset();

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
                console.error('[rs2b0t] runner listener error', err);
            }
        }
    }
}

export const ScriptRunner = new ScriptRunnerImpl();
