import { BotHost } from '../BotHost.js';
import { Scheduler } from '../runtime/Scheduler.js';

/**
 * The only way scripts sleep (PLAN.md §2). Every promise here is resolved by
 * the scheduler's frame pump, so the await chain only resumes between client
 * frames — never mid-frame — and stop/pause work by rejecting/withholding
 * these promises. Awaiting anything else (fetch, setTimeout, ...) escapes the
 * runtime's control and trips the watchdog.
 */
export const Execution = {
    /** Resolve after at least `ms` wall-clock milliseconds. */
    async delay(ms: number): Promise<void> {
        await Scheduler.enqueue({ kind: 'time', dueAt: performance.now() + ms });
    },

    /** Resolve after `n` more server ticks (~600ms each) have been observed. */
    async delayTicks(n: number): Promise<void> {
        await Scheduler.enqueue({ kind: 'tick', dueTick: BotHost.tickCount + n });
    },

    /**
     * Resolve true as soon as `cond()` holds (checked once per frame), or
     * false after `timeoutMs` (default 6000) without it holding.
     */
    delayUntil(cond: () => boolean, timeoutMs: number = 6000): Promise<boolean> {
        return Scheduler.enqueue({ kind: 'cond', cond, timeoutAt: timeoutMs > 0 ? performance.now() + timeoutMs : null });
    }
};
