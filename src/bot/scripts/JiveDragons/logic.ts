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

// Why: clicking Attack beyond weapon range makes the server walk you into range, which steps off the safespot.
const ATTACK_RANGE: Record<string, number> = { melee: 1, range: 7, mage: 10 };

export function attackRangeFor(style: string): number {
    return ATTACK_RANGE[style] ?? 1;
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
