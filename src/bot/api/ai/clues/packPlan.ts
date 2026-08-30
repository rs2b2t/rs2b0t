/**
 * Pack budgeting for a clue trail. Kept pure so the slot arithmetic is testable
 * without a bank.
 */

/**
 * A trail is not a grind. Hosts size foodWithdraw() for sustained combat (20+),
 * which alone fills the pack and starves the trail kit, the runes especially.
 */
export const TRAIL_FOOD_CAP = 10;

/** Sextant + watch + chart, fetched after banking when the bank had none. */
export const COORD_TOOL_SLOTS = 3;

// Why: runes stack, so a bigger cast budget costs the pack no extra slot, and a trail that runs dry
// Why: mid-route walks the rest of the map on foot, which is what four casts kept doing.

/** Casts of each catalogued teleport a trail carries runes for. */
export const TELEPORT_CASTS = 12;

/** Runes to hold for a teleport that burns `perCast` of them. */
export function teleportRuneTarget(perCast: number): number {
    return perCast * TELEPORT_CASTS;
}

interface TrailFoodBudget {
    /** What the host would take for its own grind. */
    hostWant: number;
    heldFood: number;
    freeSlots: number;
    /** Slots that must survive the food withdrawal (coord tools fetched later). */
    reserveSlots: number;
}

/**
 * How much food a trail should carry: the host's number capped to trail size,
 * and never more than the pack can spare once reserved slots are set aside.
 */
export function trailFoodTarget(b: TrailFoodBudget): number {
    const capped = Math.min(b.hostWant, TRAIL_FOOD_CAP);
    const room = b.heldFood + Math.max(0, b.freeSlots - b.reserveSlots);
    return Math.max(0, Math.min(capped, room));
}

/**
 * A weapon already worn is a weapon we have. Checking the backpack alone
 * withdraws a duplicate every prep, which on a full pack drops to the floor.
 */
export function weaponNeeded(weaponName: string, inBackpack: boolean, equipped: boolean): boolean {
    return weaponName !== '' && !inBackpack && !equipped;
}

// Why: the reward is rolled into a side inv and moved one slot at a time, so anything that does not fit hits the floor.
// Why: roll counts from the engine's reward scripts are easy 2+random(3), medium 3+random(3), hard 4+random(3).

/** Worst-case slots a casket needs on opening. */
export function casketRewardSlots(casketObj: string): number {
    if (casketObj.includes('_hard_')) {
        return 6;
    }
    if (casketObj.includes('_medium_')) {
        return 5;
    }
    return 4;
}
