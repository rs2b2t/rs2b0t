import Tile from '../api/Tile.js';

export const STALL_TILE = new Tile(2667, 3310, 0);
export const STAND = new Tile(2668, 3312, 0);
export const STAND_ALT = new Tile(2669, 3310, 0);
export const FLEE_TILE = new Tile(2655, 3298, 0);
export const STALL_NAME = 'Baker\'s stall';
export const STALL_OP = 'Steal from';
export const CAKE_ITEMS = ['cake', 'bread', 'chocolate slice'];

export const LOCKOUT_TICKS = 10;
export const RESET_AFTER_REFUSALS = 3;

export type StealOutcome = 'success' | 'caught' | 'lockout' | 'refused' | 'timeout';

export interface StealSignals {
    gained: boolean;
    combat: boolean;
    lockoutSeen: boolean;
    attemptSeen: boolean;
}

export function classifySteal(s: StealSignals): StealOutcome {
    if (s.gained) {
        return 'success';
    }
    if (s.combat) {
        return 'caught';
    }
    if (s.lockoutSeen) {
        return 'lockout';
    }
    if (s.attemptSeen) {
        return 'refused';
    }
    return 'timeout';
}

export function shouldReset(consecutiveRefusals: number): boolean {
    return consecutiveRefusals >= RESET_AFTER_REFUSALS;
}
