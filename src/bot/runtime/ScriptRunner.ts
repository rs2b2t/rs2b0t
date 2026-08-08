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
 * Why the script loop must hold (adapter serves stale/empty state).
 * Null = safe to run. Detached (unit tests) has no client to protect.
 *
 * Scene state 2 is the live playable scene — mid-load (teleport, login rebuild,
 * hop) is not "logged out" even though we pause the loop the same way.
 */
type LoopHoldReason = 'logged-out' | 'scene-load' | 'no-tile';

function loopHoldReason(): LoopHoldReason | null {
    if (!reader.attached()) {
        return null;
    }
    if (!reader.ingame()) {
        return 'logged-out';
    }
    if (reader.sceneState() !== 2) {
        return 'scene-load';
    }
    if (reader.worldTile() === null) {
        return 'no-tile';
    }
    return null;
}

function loopReadyOrDetached(): boolean {
    return loopHoldReason() === null;
}

function holdWarnMessage(reason: LoopHoldReason): string {
    switch (reason) {
        case 'logged-out':
            return 'logged out — holding the loop until back ingame';
        case 'scene-load':
            return `scene loading (state ${reader.sceneState()}) — holding the loop until the scene is ready`;
        case 'no-tile':
            return 'scene ready but no local tile yet — holding the loop';
    }
}

function holdResumeMessage(reason: LoopHoldReason, heldMs: number): string {
    const secs = Math.round(heldMs / 1000);
    switch (reason) {
        case 'logged-out':
            return `back ingame after ${secs}s — resuming the loop`;
        case 'scene-load':
            return `scene ready after ${secs}s — resuming the loop`;
        case 'no-tile':
            return `local tile available after ${secs}s — resuming the loop`;
    }
}

class ScriptRunnerImpl {
    ctx: ScriptContext | null = null;
    bot: AbstractBot | null = null;
    meta: ScriptMeta | null = null;

    private changeListeners = new Set<() => void>();
    /** Wall-clock start of the current loop hold (logout / scene load / no tile). */
    private holdSince = 0;
    private holdReason: LoopHoldReason | null = null;

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

        this.holdSince = 0;
        this.holdReason = null;
        ctx.loopInFlight = true;
        (async () => {
            if (!loopReadyOrDetached()) {
                const reason = loopHoldReason() ?? 'logged-out';
                if (reason === 'logged-out') {
                    ctx.addLog(
                        'warn',
                        'not ingame — waiting for login before the script reads game state (auto-login kicks in if credentials are saved)'
                    );
                } else {
                    ctx.addLog('warn', holdWarnMessage(reason));
                }
                await Execution.delayUntil(loopReadyOrDetached, 0);
                ctx.addLog('info', reason === 'logged-out' ? 'ingame — starting' : 'scene ready — starting');
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

        const hold = loopHoldReason();
        if (hold !== null) {
            if (this.holdSince === 0 || this.holdReason !== hold) {
                this.holdSince = performance.now();
                this.holdReason = hold;
                ctx.addLog('warn', holdWarnMessage(hold));
            }
            // deliberate wait, not a stall: keep StallGuard from churn-restarting
            ctx.progress();
            // Wall-clock poll while paused — server ticks may not advance mid scene load.
            scheduleNextLoop(ctx, { kind: 'time', ms: 600 });
            return;
        }
        if (this.holdSince > 0 && this.holdReason !== null) {
            ctx.addLog(
                'info',
                holdResumeMessage(this.holdReason, performance.now() - this.holdSince)
            );
            this.holdSince = 0;
            this.holdReason = null;
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
