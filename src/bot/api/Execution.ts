import { BotHost } from '../BotHost.js';
import { Scheduler } from '../runtime/Scheduler.js';

/**
 * The only legal way to sleep. Waits are settled from the client's frame
 * callback, so they follow game time and unwind cleanly on Stop.
 * @see docs/API.md#execution
 * @see docs/ARCHITECTURE.md#frame-gap-insurance
 */
export interface ExecutionApi {
    delay(ms: number): Promise<void>;
    delayTicks(n: number): Promise<void>;
    delayUntil(cond: () => boolean, timeoutMs?: number): Promise<boolean>;
    /**
     * Poll `cond` each game tick for up to `maxTicks` ticks.
     * Prefer this over {@link delayUntil} for action loops that run on the tick.
     */
    delayUntilTicks(cond: () => boolean, maxTicks: number): Promise<boolean>;
}

type WaitSpec = { kind: 'time'; dueAt: number } | { kind: 'tick'; dueTick: number } | { kind: 'cond'; cond: () => boolean; timeoutAt: number | null };

function executionFor(enqueue: (spec: WaitSpec) => Promise<boolean>): ExecutionApi {
    return {
        async delay(ms: number): Promise<void> { await enqueue({ kind: 'time', dueAt: performance.now() + ms }); },
        async delayTicks(n: number): Promise<void> { await enqueue({ kind: 'tick', dueTick: BotHost.tickCount + n }); },
        delayUntil(cond: () => boolean, timeoutMs: number = 6000): Promise<boolean> {
            return enqueue({ kind: 'cond', cond, timeoutAt: timeoutMs > 0 ? performance.now() + timeoutMs : null });
        },
        async delayUntilTicks(cond: () => boolean, maxTicks: number): Promise<boolean> {
            const n = Math.max(0, Math.floor(maxTicks));
            for (let i = 0; i < n; i++) {
                if (cond()) {
                    return true;
                }
                await enqueue({ kind: 'tick', dueTick: BotHost.tickCount + 1 });
            }
            return cond();
        }
    };
}

export const Execution: ExecutionApi = executionFor(spec => Scheduler.enqueue(spec));
/** Explicit queue for host-owned work. Never use an async-global mode here. */
export const HostExecution: ExecutionApi = executionFor(spec => Scheduler.enqueueHost(spec));
