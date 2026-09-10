import Tile from '../../geometry/Tile.js';

export const KEY = 'Crystal key';
export const PACK = 28;

// Why: the client's own names, since a drop and a count both match on those; "Swordfish" is the cooked one and "Body runes" is nothing the pack ever holds.
/** What the chest gives that is not worth carrying home. */
export const JUNK: readonly string[] = ['Raw swordfish', 'Body rune', 'Spinach roll'];

// Why: forceapproach is a BLOCK mask in the engine, so the chest's forceapproach=north is the one side it cannot be used from, and a wall loc sits on that tile anyway. West and south are the open sides; west is on the chest's own row inside the nook.
/** The chest sits at (2914, 3452); this is the tile it is opened from. */
export const CHEST_STAND = new Tile(2913, 3452, 0);
export const CHEST = 'Closed chest';

/** Keys a trip carries. */
export const KEYS_PER_TRIP = 7;

// Why: one roll in twelve is eleven rune stacks plus the dragonstone, and a pack that cannot hold it drops the overflow on the floor.
/** Slots the fattest roll needs. */
export const LOOT_SLOTS = 12;

export function junkHeld(count: (name: string) => number): number {
    return JUNK.reduce((n, name) => n + count(name), 0);
}

/** Keys to draw so the pack carries a full trip, bounded by what the bank holds. */
export function keysToWithdraw(held: number, banked: number): number {
    return Math.max(0, Math.min(KEYS_PER_TRIP - held, banked));
}

export interface PackState {
    keys: number;
    junk: number;
    /** Anything worth banking. */
    loot: number;
    free: number;
    atChest: boolean;
}

export type Step = { kind: 'drop' } | { kind: 'open' } | { kind: 'travel' } | { kind: 'bank' };

/** One step per loop, read off the pack alone so a restart lands on the same choice. */
export function decide(pack: PackState): Step {
    if (pack.junk > 0) {
        return { kind: 'drop' };
    }
    if (pack.keys > 0 && pack.free >= LOOT_SLOTS) {
        return pack.atChest ? { kind: 'open' } : { kind: 'travel' };
    }
    return { kind: 'bank' };
}
