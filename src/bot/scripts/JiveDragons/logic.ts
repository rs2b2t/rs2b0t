import { matchesCommonBankLoot } from '../../api/bank/bankRules.js';
import { CASKET_IDS, CLUE_DB } from '../../api/ai/clues/data/cluedb.js';

export type Style = 'melee' | 'mage' | 'range';

/** How long the safespot may see no adult before the bot rotates off it. */
export const SAFESPOT_BLIND_MS = 20_000;

export interface LadderState {
    index: number;
    spots: number;
    /** HP fell while standing on the current safespot. */
    hurt: boolean;
    /** How long no adult has been in line of sight. */
    blindMs: number;
}

// Why: the tiles are derived as melee-proof, so a hit is the derivation being wrong and the blind window is a dragon body parked across the angle.

/** The safespot index to stand on next. */
export function nextSafespot(s: LadderState): number {
    if (s.spots <= 1) {
        return 0;
    }
    if (!s.hurt && s.blindMs < SAFESPOT_BLIND_MS) {
        return s.index;
    }
    return (s.index + 1) % s.spots;
}

export interface RetreatState {
    inLair: boolean;
    /** Standing on one of the site's safespots right now. */
    onSafespot: boolean;
    hpFrac: number;
    retreatHp: number;
    hasFood: boolean;
    spots: number;
}

// Why: eating in dragonfire is a race the bot loses, so the walk out of the fire outranks the bite.
// Why: an empty pack is left to the bank run, because a retreat that cannot heal only makes melee step off its anchor and back forever.

/** Whether to break off and heal on a safespot instead of where the bot stands. */
export function retreatDue(s: RetreatState): boolean {
    return s.inLair && s.spots > 0 && !s.onSafespot && s.hasFood && s.hpFrac < s.retreatHp;
}

export interface Spot {
    x: number;
    z: number;
}

// Why: nothing in the walker returns a path cost, only a reachable yes or no, and the spots sit within a few tiles of each other where Chebyshev and a real path agree.

/** Index of the safespot fewest tiles away, ties going to the earlier one. */
export function nearestSpot(from: Spot, spots: readonly Spot[]): number {
    let best = 0;
    let bestDist = Infinity;
    for (const [i, spot] of spots.entries()) {
        const dist = Math.max(Math.abs(spot.x - from.x), Math.abs(spot.z - from.z));
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

export interface RetreatAim {
    /** The index a failed attempt rotated to, or null when this retreat is a fresh one. */
    rotated: number | null;
    from: Spot;
    spots: readonly Spot[];
}

// Why: a retry that recomputes the nearest spot from the tile it never left picks the spot it just failed on, so a rotation only sticks by being carried into the next attempt.

/** Which safespot a retreat walks at, and which one it tries if that one cannot be reached. */
export function retreatAim(a: RetreatAim): { index: number; next: number } {
    const index = a.rotated ?? nearestSpot(a.from, a.spots);
    return { index, next: a.spots.length > 0 ? (index + 1) % a.spots.length : index };
}

// Why: clicking Attack beyond weapon range makes the server walk you into range, which steps off the safespot.
const ATTACK_RANGE: Record<Style, number> = { melee: 1, range: 7, mage: 10 };

export function attackRangeFor(style: Style): number {
    return ATTACK_RANGE[style];
}

// Why: dragonfire is 5 through the shield and 30 without, rising to 50 when the attack roll beats the defence roll.
// Why: mage and range fight from a tile no footprint touches, and the op trigger is the only thing that breathes, so the shield would only cost the slot the weapon needs.

/** Why melee may not start, or null when it may. */
export function meleeShieldGate(style: Style, hasShield: boolean): string | null {
    if (style !== 'melee' || hasShield) {
        return null;
    }
    return 'melee needs the Dragonfire shield and there is none in the bank or worn. Duke Horacio in Lumbridge Castle hands one out free, or switch to mage or range, which fight from a fire-proof safespot.';
}

/** Every hard trail is a distinct obj all displaying "Clue scroll", so id is the only match. */
export function isClueObj(id: number): boolean {
    return CLUE_DB[id] !== undefined || CASKET_IDS[id] !== undefined;
}

export interface DropFilter {
    loot: ReadonlySet<string>;
    bankCommon: boolean;
    solveClues: boolean;
    buryBones: boolean;
    boneName: string;
}

// Why: clues and burial bones ignore the loot list, so unticking a box cannot silently stop clue solving or leave the bones the run was told to bury.

/** Whether a ground item is worth a slot. */
export function wantsDrop(item: { id: number; name: string | null }, f: DropFilter): boolean {
    if (f.solveClues && isClueObj(item.id)) {
        return true;
    }
    const name = item.name ?? '';
    if (name.length === 0) {
        return false;
    }
    const lower = name.toLowerCase();
    if (f.buryBones && lower === f.boneName.toLowerCase()) {
        return true;
    }
    return f.loot.has(lower) || (f.bankCommon && matchesCommonBankLoot(name, item.id));
}

/** Where the next dusty key comes from. */
export function keyStatus(held: number, banked: number): 'held' | 'bank' | 'fetch' {
    if (held > 0) {
        return 'held';
    }
    return banked > 0 ? 'bank' : 'fetch';
}
