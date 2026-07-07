import { BotHost } from '../BotHost.js';
import { ScriptAborted, ScriptContext, type Waiter, type WaiterSpec } from './ScriptContext.js';

const WATCHDOG_MS = 10000;
/** A frame-to-frame gap this large means the page was throttled (background
 *  tab) or the machine slept — normal frames are ~20ms apart. */
const FRAME_GAP_MS = 1500;
const NOMINAL_FRAME_MS = 20;

/**
 * The frame pump. Scripts only make progress here: BotHost.onFrame() calls
 * pump() once per client frame, which resolves due waiters and launches loop
 * iterations. Between awaits a script therefore sees frozen, consistent game
 * state (PLAN.md §2).
 *
 * v1 runs a single active script; Execution.* binds to it implicitly.
 */
class SchedulerImpl {
    /** The active run, if any. Owned by ScriptRunner. */
    active: ScriptContext | null = null;

    /** Launches one loop iteration; installed by ScriptRunner at start(). */
    launchLoop: ((ctx: ScriptContext) => void) | null = null;

    /** When set and returning true, new loop iterations are withheld (human
     *  breaks). In-flight loops and Execution.* waiters are unaffected. */
    launchGate: (() => boolean) | null = null;

    /** Times the frame-gap insurance fired (telemetry; see pump()). */
    gapShifts = 0;

    private lastPumpAt = 0;

    constructor() {
        BotHost.addFrameListener(() => this.pump());
    }

    /** Register a waiter for the active script. Used by Execution.* only. */
    enqueue(spec: WaiterSpec): Promise<boolean> {
        const ctx = this.active;
        if (!ctx) {
            return Promise.reject(new Error('Execution.* called with no script running'));
        }
        if (ctx.aborted) {
            return Promise.reject(new ScriptAborted());
        }

        ctx.progress();
        return new Promise<boolean>((resolve, reject) => {
            ctx.waiters.push({ ...spec, resolve, reject });
        });
    }

    private pump(): void {
        const now = performance.now();
        const gap = this.lastPumpAt > 0 ? now - this.lastPumpAt : 0;
        this.lastPumpAt = now;

        const ctx = this.active;
        if (!ctx || ctx.state !== 'running') {
            return;
        }

        // Frame-gap insurance: wall-clock deadlines assume ~50fps frames. If
        // the page was throttled (background browser tab) or the machine
        // slept, the clock ran while no frames did — shift every pending
        // deadline by the gap (same mechanic as pause/resume) so waits don't
        // falsely expire and the catch-up burst doesn't mis-time the script.
        if (gap > FRAME_GAP_MS) {
            const shift = gap - NOMINAL_FRAME_MS;
            for (const waiter of ctx.waiters) {
                if (waiter.kind === 'time') {
                    waiter.dueAt += shift;
                } else if (waiter.kind === 'cond' && waiter.timeoutAt !== null) {
                    waiter.timeoutAt += shift;
                }
            }
            ctx.nextLoopAt += shift;
            ctx.progress();
            this.gapShifts++;
            ctx.addLog('warn', `frame gap of ${(gap / 1000).toFixed(1)}s (throttled tab or system sleep) — shifted timers to compensate`);
        }

        // resolve due waiters (cond waiters evaluate against the state this
        // frame just produced)
        const tick = BotHost.tickCount;
        const still: Waiter[] = [];

        for (const waiter of ctx.waiters) {
            const settled = this.trySettle(waiter, now, tick, ctx);
            if (!settled) {
                still.push(waiter);
            }
        }
        ctx.waiters = still;

        // launch the next loop iteration when the previous settled and the
        // requested delay elapsed — unless a human break is in progress
        if (!ctx.loopInFlight && now >= ctx.nextLoopAt && this.launchLoop && !(this.launchGate && this.launchGate())) {
            ctx.progress();
            this.launchLoop(ctx);
        }

        // watchdog: in flight, nothing registered with the pump, no progress
        // — either a synchronous hang (can't be killed in-thread) or an await
        // on a promise the pump doesn't own (unsupported, see PLAN.md)
        if (ctx.loopInFlight && ctx.waiters.length === 0 && now - ctx.lastProgressAt > WATCHDOG_MS && !ctx.watchdogWarned) {
            ctx.watchdogWarned = true;
            ctx.addLog('warn', `watchdog: loop() has made no scheduler progress for ${Math.round((now - ctx.lastProgressAt) / 1000)}s — sync-stuck or awaiting a non-Execution promise`);
        }
    }

    private trySettle(waiter: Waiter, now: number, tick: number, ctx: ScriptContext): boolean {
        if (waiter.kind === 'time') {
            if (now >= waiter.dueAt) {
                ctx.progress();
                waiter.resolve(true);
                return true;
            }
            return false;
        }

        if (waiter.kind === 'tick') {
            if (tick >= waiter.dueTick) {
                ctx.progress();
                waiter.resolve(true);
                return true;
            }
            return false;
        }

        // cond
        try {
            if (waiter.cond()) {
                ctx.progress();
                waiter.resolve(true);
                return true;
            }
        } catch (err) {
            ctx.progress();
            waiter.reject(err instanceof Error ? err : new Error(String(err)));
            return true;
        }

        if (waiter.timeoutAt !== null && now >= waiter.timeoutAt) {
            ctx.progress();
            waiter.resolve(false); // delayUntil timeout -> false, not a throw
            return true;
        }

        return false;
    }
}

export const Scheduler = new SchedulerImpl();
