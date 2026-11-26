import { Execution } from '../execution/Execution.js';

const RESPIN_AFTER_TICKS = 6;

interface SpinningBatch {
    fibreCount(): number;
    recordSpun(amount: number): void;
}

export async function rideSpinningWheel(batch: SpinningBatch, initialCount: number, interrupted: () => boolean): Promise<void> {
    let last = initialCount;
    let idle = 0;
    while (batch.fibreCount() > 0 && !interrupted()) {
        await Execution.delayTicks(1);
        const now = batch.fibreCount();
        if (now < last) {
            batch.recordSpun(last - now);
            last = now;
            idle = 0;
        } else if (++idle >= RESPIN_AFTER_TICKS) {
            return;
        }
    }
}
