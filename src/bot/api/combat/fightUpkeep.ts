import { reader } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../../runtime/BotHost.js';
import { Execution } from '../execution/Execution.js';
import { Inventory } from '../inventory/Inventory.js';
import { AttackClock } from './eatTiming.js';

const BURY_CONFIRM_TICKS = 3;

/** One bot runs at a time, so a module-level clock is enough. */
const clock = new AttackClock();

/**
 * True on the tick our swing animation began.
 * Why: anything that costs a tick (eating, burying, a dose) must skip that tick and spend the cooldown instead, or it stalls an attack.
 */
export function swingStartedThisTick(): boolean {
    clock.observe(reader.selfAnim(), BotHost.tickCount);
    return clock.attackedThisTick(BotHost.tickCount);
}

// Why: Long fight loops block sibling tasks, so bury bones during combat cooldowns and report only completed burials.

/** Bury one bone from inside a fight loop. */
export async function buryOneInFight(boneName: string): Promise<boolean> {
    if (swingStartedThisTick()) {
        return false;
    }
    const bones = Inventory.first(boneName);
    if (!bones) {
        return false;
    }
    const before = Inventory.used();
    if (!(await bones.interact('Bury'))) {
        return false;
    }
    return Execution.delayUntilTicks(() => Inventory.used() < before, BURY_CONFIRM_TICKS);
}
