import { BotHost } from '../BotHost.js';
import { Scheduler } from '../runtime/Scheduler.js';

export const Execution = {
    async delay(ms: number): Promise<void> {
        await Scheduler.enqueue({ kind: 'time', dueAt: performance.now() + ms });
    },

    async delayTicks(n: number): Promise<void> {
        await Scheduler.enqueue({ kind: 'tick', dueTick: BotHost.tickCount + n });
    },

    delayUntil(cond: () => boolean, timeoutMs: number = 6000): Promise<boolean> {
        return Scheduler.enqueue({ kind: 'cond', cond, timeoutAt: timeoutMs > 0 ? performance.now() + timeoutMs : null });
    }
};
