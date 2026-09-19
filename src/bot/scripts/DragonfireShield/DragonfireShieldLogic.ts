import Tile from '../../geometry/Tile.js';

// Why: the farm is one server var short of an uncompleted Dark Slayer quest: `%dragon_shield = 1`
// (set when Oziach tells you where the shield is) makes Duke Horacio hand out a free un-noted
// anti-dragonbreath shield every conversation while the player holds none in pack or worn.
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
    if (p.atBank && (p.unNoted > 0 || p.junk > 0 || (p.wantNotes && p.notes === 0 && p.free > 0))) {
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