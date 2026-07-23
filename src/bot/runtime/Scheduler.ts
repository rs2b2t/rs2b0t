import { BotHost } from '../BotHost.js';
import { ScriptAborted, ScriptContext, type Waiter, type WaiterSpec } from './ScriptContext.js';

const WATCHDOG_MS = 10000;
const FRAME_GAP_MS = 1500;
const NOMINAL_FRAME_MS = 20;

class SchedulerImpl {
    active: ScriptContext | null = null;

    launchLoop: ((ctx: ScriptContext) => void) | null = null;

    gapShifts = 0;

    private lastPumpAt = 0;

    constructor() {
        BotHost.addFrameListener(() => this.pump());
    }

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

        const tick = BotHost.tickCount;
        const still: Waiter[] = [];

        for (const waiter of ctx.waiters) {
            const settled = this.trySettle(waiter, now, tick, ctx);
            if (!settled) {
                still.push(waiter);
            }
        }
        ctx.waiters = still;

        if (!ctx.loopInFlight && now >= ctx.nextLoopAt && this.launchLoop) {
            ctx.progress();
            this.launchLoop(ctx);
        }

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
            waiter.resolve(false);
            return true;
        }

        return false;
    }
}

export const Scheduler = new SchedulerImpl();
