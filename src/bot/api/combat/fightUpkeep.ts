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
 * Why: anything that costs a tick, such as eating, burying or drinking a dose, must skip that one tick and spend the cooldown instead, or it stalls an attack.
 */
export function swingStartedThisTick(): boolean {
    clock.observe(reader.selfAnim(), BotHost.tickCount);
    return clock.attackedThisTick(BotHost.tickCount);
}

// Why: this belongs in the fight loop rather than a sibling task, because a combat bot's fight `execute()` owns the bot for 90–120s at a time and a BuryBones task above it is only reached in whatever gaps that loop leaves, which reads as burying at random moments.
// Why: true is returned only when a bone left the pack.

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
