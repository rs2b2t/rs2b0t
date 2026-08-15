import { matchesCommonBankLoot } from '../../api/bank/bankRules.js';
import { CASKET_IDS, CLUE_DB } from '../../api/ai/clues/data/cluedb.js';

/** First wilderness row north of the Edgeville ditch. */
export const WILDY_MIN_Z = 3520;

/** Hold before walking back after a threat-driven escape. */
export const RETURN_HOLD_MS = 60_000;

export function inWilderness(z: number): boolean {
    return z > WILDY_MIN_Z;
}

// Why: a PKer only registers once auto-retaliate points us back at them.
// Why: our face target does not decay when they leave, so the wilderness gate is what ends the threat.

/** True while a player is attacking us in the wilderness. */
export function underPlayerAttack(z: number | null, retaliatingAtPlayer: boolean): boolean {
    return z !== null && retaliatingAtPlayer && inWilderness(z);
}

/**
 * Matched by id, not name: every hard trail is a distinct obj all displaying as
 * "Clue scroll".
 */
export function isClueLike(id: number): boolean {
    return CLUE_DB[id] !== undefined || CASKET_IDS[id] !== undefined;
}

interface LootFilter {
    lootSet: ReadonlySet<string>;
    bankCommon: boolean;
    solveClues: boolean;
    buryBones?: boolean;
    boneName?: string;
}

/**
 * Clues and burial bones ignore lootSet — unchecking a loot box must not
 * silently disable clue solving or leave the bones you asked to bury.
 */
export function wantsGroundItem(item: { id: number; name: string | null }, f: LootFilter): boolean {
    if (f.solveClues && isClueLike(item.id)) {
        return true;
    }
    const name = item.name ?? '';
    if (name.length === 0) {
        return false;
    }
    const n = name.toLowerCase();
    if (f.buryBones === true && f.boneName !== undefined && n === f.boneName.toLowerCase()) {
        return true;
    }
    return f.lootSet.has(n) || (f.bankCommon && matchesCommonBankLoot(name, item.id));
}

// Why: only the weapon and shield are configured, so armour worn at start would be banked on the first trip, or stripped for an Entrana clue, and never re-equipped.

/** Gear the bot must keep and put back on. */
export function gearCandidates(weapon: string, shield: string, tracked: readonly string[]): string[] {
    const out: string[] = [];
    for (const name of [weapon, shield, ...tracked]) {
        if (name !== '' && !out.some(seen => seen.toLowerCase() === name.toLowerCase())) {
            out.push(name);
        }
    }
    return out;
}

// Why: keeping a worn item by name also shields a looted duplicate from the deposit, and our own armour is on the drop table, so the pack fills with helms that never bank.

/** Gear that earns a keep slot: the pieces currently off. */
export function gearToKeep(gear: readonly string[], worn: (name: string) => boolean): string[] {
    return gear.filter(n => !worn(n));
}

/** Chebyshev radius around the bank stand that counts as "the flee finished". */
export const AT_BANK_RADIUS = 8;

interface EscapeState {
    threat: boolean;
    hpFraction: number;
    panicHp: number;
    hasFood: boolean;
    atBank: boolean;
}

// Why: low hp and no food stay true after arriving, so re-validating at the bank re-walks a zero-tile path and wedges the bot on the spot.
// Why: restocking is the bank run's job, which sits below this task.

/** Whether an escape is still needed; a flee ends at the bank. */
export function escapeNeeded(s: EscapeState): boolean {
    if (s.threat) {
        return true;
    }
    return !s.atBank && s.hpFraction < s.panicHp && !s.hasFood;
}

// Why: food is a resource the bot spends and slot-freeing turns it into room, so a pack full of food is no reason to bank.

/** Whether the pack alone forces the bank trip. */
export function packForcesBank(packFull: boolean, foodCount: number, foodReserve: number): boolean {
    return packFull && foodCount <= foodReserve;
}

// Why: carrying a trail's spade, sextant, watch, chart, god page or stray runes back to the dragons wastes slots, so holding any forces a bank-and-restock.

/** Items that are neither grind kit nor intended loot. */
export function isGrindForeign(item: { id: number; name: string | null }, ctx: { keep: ReadonlySet<string>; loot: LootFilter }): boolean {
    const name = item.name ?? '';
    if (name.length === 0 || isClueLike(item.id)) {
        return false;
    }
    if (ctx.keep.has(name.toLowerCase())) {
        return false;
    }
    return !wantsGroundItem(item, ctx.loot);
}

export type SlotAction = 'eat' | 'drop' | 'none';

export interface SlotFreeingState {
    packFull: boolean;
    lootPresent: boolean;
    foodCount: number;
    foodReserve: number;
    hpFraction: number;
    /** Loot merges into a stack already held, so no slot is needed. */
    lootStacksIntoPack: boolean;
}

// Why: eating wins whenever the heal is not wasted, and at full hp the food is dropped instead.
// Why: the reserve is never dug into — below it the caller falls through to its bank run.

/** Trades a food slot for a loot slot rather than walking to the bank. */
export function slotFreeingAction(s: SlotFreeingState): SlotAction {
    if (!s.packFull || !s.lootPresent || s.lootStacksIntoPack) {
        return 'none';
    }
    if (s.foodCount <= s.foodReserve) {
        return 'none';
    }
    return s.hpFraction < 1 ? 'eat' : 'drop';
}
