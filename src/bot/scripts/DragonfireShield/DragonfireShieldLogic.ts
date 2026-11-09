import Tile from '../../geometry/Tile.js';

// Why: `%dragon_shield = 1` (set when Oziach names the shield) makes Duke Horacio hand out a free shield each conversation.
export const SHIELD_ID = 1540;
export const SHIELD = 'Dragonfire shield';
export const DUKE = 'Duke Horacio';
export const DUKE_STAND = new Tile(3212, 3220, 1);
export const STAND_REACH = 4;
export const BANK_STAND = new Tile(3269, 3167, 0);
export const BANK_REACH = 5;
export const BOOTH = 'Bank booth';
export const BOOTH_OP = 'Use-quickly';
export const MAX_TALK_GUARD = 100;

// Why: the Al Kharid gate charges 20 gp per crossing until Prince Ali Rescue is complete; the walk planner pays it.
export const COINS_ID = 995;
export const PRINCE_ALI_QUEST = 'Prince Ali Rescue';
export const GATE_FEE = 20;

export type Step = 'farm' | 'loot' | 'bank' | 'duke' | 'wait';

export interface PackState {
    atStand: boolean;
    atBank: boolean;
    full: boolean;
    free: number;
    /** Un-noted shields in the pack (the only count the Duke's gate sees). */
    unNoted: number;
    /** Noted shields in the pack. */
    notes: number;
    /** Non-shield junk in the pack. */
    junk: number;
    /** Shield ground items at the Duke. */
    ground: number;
    tripActive: boolean;
    wantNotes: boolean;
    /** A bank trip has found shields to withdraw; without it an empty bank would loop "notes missing" forever. */
    hasBankedShields: boolean;
}

export function decide(p: PackState): Step {
    if (p.tripActive && p.atStand && !p.full) {
        return 'farm';
    }
    if (p.full) {
        return 'bank';
    }
    if (p.atStand && !p.tripActive && p.ground > 0) {
        return 'loot';
    }
    if (p.atStand && !p.tripActive && p.ground === 0 && (p.unNoted > 0 || p.notes > 0 || p.junk > 0)) {
        return 'bank';
    }
    if (p.atBank && (p.unNoted > 0 || p.junk > 0 || (p.wantNotes && p.hasBankedShields && p.notes === 0 && p.free > 0))) {
        return 'bank';
    }
    if (!p.atStand) {
        return 'duke';
    }
    if (p.atStand && !p.tripActive && p.ground === 0 && !p.full) {
        return 'farm';
    }
    return 'wait';
}