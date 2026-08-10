import { reader } from '../../adapter/ClientAdapter.js';
import { BotHost } from '../../BotHost.js';
import { Execution } from '../Execution.js';
import { Inventory } from '../hud/Inventory.js';
import { AttackClock } from './eatTiming.js';

const BURY_CONFIRM_TICKS = 3;

/** One bot runs at a time, so a module-level clock is enough. */
const clock = new AttackClock();

/**
 * True on the tick our swing animation began.
 *
 * Anything that costs a tick — eating, burying — should skip that one tick and
 * spend the cooldown instead, or it stalls an attack.
 */
export function swingStartedThisTick(): boolean {
    clock.observe(reader.selfAnim(), BotHost.tickCount);
    return clock.attackedThisTick(BotHost.tickCount);
}

/**
 * Bury one bone from inside a fight loop.
 *
 * Belongs in the fight loop, not in a sibling task: a combat bot's fight
 * `execute()` owns the bot for 90–120s at a time, so a BuryBones task above it
 * is only ever reached in whatever gaps that loop happens to leave — which
 * reads as the bot burying at random moments instead of steadily.
 *
 * Returns true when a bone actually left the pack.
 */
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
