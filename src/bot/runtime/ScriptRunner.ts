import { reader } from '../adapter/ClientAdapter.js';
import { resolveLoopCadence, type AbstractBot, type LoopCadence } from '../api/bot/Bot.js';
import { Execution } from '../api/execution/Execution.js';
import { RandomEvents } from './randomevents/RandomEvents.js';
import { Sustain } from '../api/sustain/Sustain.js';
import type { PaintFrame } from '../paint/Paint.js';
import { paintState } from '../paint/paintLogic.js';
import { BotHost } from './BotHost.js';
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

// Why: detached, as in unit tests, has no client to protect.
// Why: scene state 2 is the live playable scene, and mid-load (teleport, login rebuild, hop) is not logged out even though the loop pauses the same way.

/** Why the script loop must hold (the adapter serves stale or empty state); null means safe to run. */
type LoopHoldReason = 'logged-out' | 'scene-load' | 'no-tile' | 'stats-load';

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
    if (!reader.statsReady()) {
        return 'stats-load';
    }
    return null;
}

export function loopReadyOrDetached(): boolean {
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
        case 'stats-load':
            return 'scene ready but stats are still loading — holding the loop';
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
        case 'stats-load':
            return `stats ready after ${secs}s — resuming the loop`;
    }
}

/**
 * Never let a blank reason read as "the script stopped for no reason".
 * Why: a missing reason is a caller bug, and throwing out of `stop()` would leave the run wedged in `running` forever, which broke every harness that calls `runner.stop()` from page context.
 */
export function stopReasonOf(reason: string): string {
    return (reason ?? '').trim() || 'no reason given by the caller (bug — please report)';
}

/** One-line summary of how a finished run ended, for the next run's log. */
function endEpitaph(ctx: ScriptContext): string {
    if (ctx.state === 'crashed') {
        return `crashed: ${ctx.crashError?.message ?? 'unknown error'}`;
    }
    return `ended (${ctx.state}) — ${ctx.stopReason ?? 'no reason recorded'}`;
}

class ScriptRunnerImpl {
    ctx: ScriptContext | null = null;
    bot: AbstractBot | null = null;
    meta: ScriptMeta | null = null;

    private changeListeners = new Set<() => void>();
    /** onStart has returned and established any baselines consumed by onPaint. */
    private startupComplete = false;
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
            this.stop('Stop button (paint overlay)');
        }
    }

    get state(): string {
        return this.ctx?.state ?? 'idle';
    }

    /** The bot that may safely paint this frame, or null while startup/state is incomplete. */
    get paintBot(): AbstractBot | null {
        const state = this.ctx?.state;
        if (
            !this.startupComplete ||
            (state !== 'running' && state !== 'paused') ||
            !loopReadyOrDetached()
        ) {
            return null;
        }
        return this.bot;
    }

    start(meta: ScriptMeta): void {
        if (this.ctx && (this.ctx.state === 'running' || this.ctx.state === 'paused' || this.ctx.state === 'stopping')) {
            throw new Error(`'${this.meta?.name}' is still ${this.ctx.state}`);
        }

        const previous = this.ctx ? { name: this.meta?.name ?? '?', epitaph: endEpitaph(this.ctx) } : null;
        const ctx = new ScriptContext();
        const bot = meta.create();
        bot.bindLog(msg => ctx.addLog('info', msg));
        if (meta.settingsSchema) {
            bot.settings = new SettingsBag(SettingsStore.resolve(meta.name, meta.settingsSchema));
        }

        this.ctx = ctx;
        this.bot = bot;
        this.meta = meta;
        this.startupComplete = false;
        Scheduler.active = ctx;


        // Why: a restart (StallGuard) throws away the old context along with its log, the only place the reason the previous run ended was recorded, so it is carried over.
        if (previous) {
            ctx.addLog('info', `previous run of '${previous.name}' ${previous.epitaph}`);
        }
        ctx.addLog('info', `${meta.name} started`);
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
                ctx.addLog(
                    'info',
                    reason === 'logged-out'
                        ? 'ingame — starting'
                        : reason === 'stats-load'
                            ? 'stats ready — starting'
                            : 'scene ready — starting'
                );
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
                RandomEvents.setIgnoredRandoms(() => bot.ignoredRandoms());
                RandomEvents.setLampSkill(SettingsStore.globalBag().str('lampSkill', 'strength'));
                Supervisor.resetProgress();
                if (RecoveryHints.pendingRecovery) {
                    RecoveryHints.clear();
                }
                this.startupComplete = true;
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

        // Why: a previous loop() can still be in flight, blocked on a non-Execution promise that will not resolve while the scheduler was paused, so the flag is cleared to let the pump launch a fresh iteration.
        // Why: the stale .then() handler fires later but only sets timing gates (scheduleNextLoop) and bumps loopCount, which is harmless.
        ctx.loopInFlight = false;

        try {
            bot?.onResume?.();
        } catch (err) {
            ctx.addLog('warn', `onResume threw: ${err}`);
        }
        ctx.addLog('info', 'resumed');
        this.fireChange();
    }

    /**
     * `reason` is mandatory so no caller can end a run without leaving a starting point for debugging.
     * Why: it is echoed on both the stopping and stopped lines and carried into the next run's log by {@link start}.
     */
    stop(reason: string): void {
        const ctx = this.ctx;
        if (!ctx || ctx.state === 'stopped' || ctx.state === 'crashed') {
            return;
        }

        if (ctx.state === 'stopping') {
            return;
        }

        ctx.stopReason = stopReasonOf(reason);
        ctx.state = 'stopping';
        ctx.addLog('info', `stopping — ${ctx.stopReason}`);
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

                // Why: takeover / supervisor allows one server tick between intercepts.
                // Why: a numeric return from loop() keeps legacy wall-clock meaning only when it is not the historical "600 = one tick" value (resolveLoopCadence).
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
        ctx.stopReason ??= stopReasonOf('');
        ctx.addLog('info', `stopped — ${ctx.stopReason}`);
        // Also to the console: the panel only shows the *current* context's log,
        // so a restart would otherwise erase why the last run ended.
        console.log(`[rs2b0t] ${this.meta?.name ?? 'script'} stopped — ${ctx.stopReason}`);
        this.teardown(ctx);
    }

    private teardown(ctx: ScriptContext): void {
        this.startupComplete = false;
        try {
            this.bot?.onStop?.();
        } catch (err) {
            ctx.addLog('warn', `onStop threw: ${err}`);
        }

        RandomEvents.setIgnoredRandoms([]);

        Sustain.set(null);

        paintState.reset();


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
