import { BotHost } from '../../runtime/BotHost.js';
import { Scheduler } from '../../runtime/Scheduler.js';

/**
 * The only legal way to sleep. Waits are settled from the client's frame
 * callback, so they follow game time and unwind cleanly on Stop.
 * @see docs/reference/api-bots.md#execution
 * @see docs/decisions/architecture.md#frame-gap-insurance
 */
export const Execution = {
    async delay(ms: number): Promise<void> {
        await Scheduler.enqueue({ kind: 'time', dueAt: performance.now() + ms });
    },

    async delayTicks(n: number): Promise<void> {
        await Scheduler.enqueue({ kind: 'tick', dueTick: BotHost.tickCount + n });
    },

    delayUntil(cond: () => boolean, timeoutMs: number = 6000): Promise<boolean> {
        return Scheduler.enqueue({ kind: 'cond', cond, timeoutAt: timeoutMs > 0 ? performance.now() + timeoutMs : null });
    },

    /** Work the watchdog cannot see from tile or xp. Call it only after work was observed: an unconditional call per loop turns wedge detection off. */
    noteProgress(): void {
        Scheduler.active?.noteProgress();
    },

    /**
     * Poll `cond` each game tick for up to `maxTicks` ticks.
     * Prefer this over {@link delayUntil} for action loops that run on the tick.
     */
    async delayUntilTicks(cond: () => boolean, maxTicks: number): Promise<boolean> {
        const n = Math.max(0, Math.floor(maxTicks));
        for (let i = 0; i < n; i++) {
            if (cond()) {
                return true;
            }
            await Scheduler.enqueue({ kind: 'tick', dueTick: BotHost.tickCount + 1 });
        }
        return cond();
    }
};
