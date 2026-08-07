import { BotHost } from '../BotHost.js';
import { ScriptAborted, ScriptContext, type Waiter, type WaiterSpec } from './ScriptContext.js';

const WATCHDOG_MS = 10000;
const FRAME_GAP_MS = 1500;
const NOMINAL_FRAME_MS = 20;

// docs/ARCHITECTURE.md#frame-gap-insurance
class SchedulerImpl {
    active: ScriptContext | null = null;

    launchLoop: ((ctx: ScriptContext) => void) | null = null;

    gapShifts = 0;

    private lastPumpAt = 0;

    /**
     * Waiters from explicit host-owned execution. Settled every frame
     * regardless of ScriptRunner state — including paused scripts.
     */
    private hostWaiters: Waiter[] = [];

    constructor() {
        BotHost.addFrameListener(() => this.pump());
    }

    enqueue(spec: WaiterSpec): Promise<boolean> {
        if (!this.active) {
            return this.enqueueHost(spec);
        }

        const ctx = this.active;
        if (ctx.aborted) {
            return Promise.reject(new ScriptAborted());
        }

        ctx.progress();
        return new Promise<boolean>((resolve, reject) => {
            ctx.waiters.push({ ...spec, resolve, reject });
        });
    }

    /** Explicit host queue. Do not infer this from an async-global flag. */
    enqueueHost(spec: WaiterSpec): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.hostWaiters.push({ ...spec, resolve, reject });
        });
    }

    private pump(): void {
        const now = performance.now();
        const gap = this.lastPumpAt > 0 ? now - this.lastPumpAt : 0;
        this.lastPumpAt = now;
        const tick = BotHost.tickCount;

        // Host-level waits (no script) — always pump so guardian/maze can sleep.
        if (this.hostWaiters.length > 0) {
            if (gap > FRAME_GAP_MS) {
                this.shiftWaiters(this.hostWaiters, gap - NOMINAL_FRAME_MS);
            }
            const stillHost: Waiter[] = [];
            for (const waiter of this.hostWaiters) {
                if (!this.trySettle(waiter, now, tick, null)) {
                    stillHost.push(waiter);
                }
            }
            this.hostWaiters = stillHost;
        }

        const ctx = this.active;
        if (!ctx || ctx.state !== 'running') {
            return;
        }

        if (gap > FRAME_GAP_MS) {
            const shift = gap - NOMINAL_FRAME_MS;
            this.shiftWaiters(ctx.waiters, shift);
            ctx.nextLoopAt += shift;
            ctx.progress();
            this.gapShifts++;
            ctx.addLog(
                'warn',
                `frame gap of ${(gap / 1000).toFixed(1)}s (throttled tab or system sleep) — shifted timers to compensate`
            );
        }

        const still: Waiter[] = [];
        for (const waiter of ctx.waiters) {
            const settled = this.trySettle(waiter, now, tick, ctx);
            if (!settled) {
                still.push(waiter);
            }
        }
        ctx.waiters = still;

        // Both gates must pass: wall-clock (`nextLoopAt`) and optional server-tick
        // (`nextLoopTick`). Tick-aligned loops set nextLoopAt=0 and nextLoopTick=N.
        const wallOk = now >= ctx.nextLoopAt;
        const tickOk = ctx.nextLoopTick === 0 || tick >= ctx.nextLoopTick;
        if (!ctx.loopInFlight && wallOk && tickOk && this.launchLoop) {
            ctx.progress();
            this.launchLoop(ctx);
        }

        if (
            ctx.loopInFlight &&
            ctx.waiters.length === 0 &&
            ctx.watchdogHold === null &&
            now - ctx.lastProgressAt > WATCHDOG_MS &&
            !ctx.watchdogWarned
        ) {
            ctx.watchdogWarned = true;
            ctx.addLog(
                'warn',
                `watchdog: loop() has made no scheduler progress for ${Math.round((now - ctx.lastProgressAt) / 1000)}s — sync-stuck or awaiting a non-Execution promise`
            );
        }
    }

    private shiftWaiters(waiters: Waiter[], shift: number): void {
        for (const waiter of waiters) {
            if (waiter.kind === 'time') {
                waiter.dueAt += shift;
            } else if (waiter.kind === 'cond' && waiter.timeoutAt !== null) {
                waiter.timeoutAt += shift;
            }
        }
    }

    private trySettle(waiter: Waiter, now: number, tick: number, ctx: ScriptContext | null): boolean {
        const progress = (): void => {
            ctx?.progress();
        };

        if (waiter.kind === 'time') {
            if (now >= waiter.dueAt) {
                progress();
                waiter.resolve(true);
                return true;
            }
            return false;
        }

        if (waiter.kind === 'tick') {
            if (tick >= waiter.dueTick) {
                progress();
                waiter.resolve(true);
                return true;
            }
            return false;
        }

        try {
            if (waiter.cond()) {
                progress();
                waiter.resolve(true);
                return true;
            }
        } catch (err) {
            progress();
            waiter.reject(err instanceof Error ? err : new Error(String(err)));
            return true;
        }

        if (waiter.timeoutAt !== null && now >= waiter.timeoutAt) {
            progress();
            waiter.resolve(false);
            return true;
        }

        return false;
    }
}

export const Scheduler = new SchedulerImpl();
