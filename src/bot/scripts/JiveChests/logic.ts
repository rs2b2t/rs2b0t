import Tile from '../../geometry/Tile.js';

export const KEY = 'Crystal key';
export const PACK = 28;

// Why: the client's own names, since a drop and a count both match on those; "Swordfish" is the cooked one and "Body runes" is nothing the pack ever holds.
/** What the chest gives that is not worth carrying home. */
export const JUNK: readonly string[] = ['Raw swordfish', 'Body rune', 'Spinach roll', 'Adamant sq shield'];

/** The chest sits at (2914, 3452); this is the tile it is opened from. */
export const CHEST_STAND = new Tile(2914, 3451, 0);
export const CHEST = 'Closed chest';

/** Keys a trip carries. */
export const KEYS_PER_TRIP = 7;

const REWARDS = [
    ['Uncut dragonstone'],
    ['Half of a key'],
    ['Runite bar'],
    ['Diamond'],
    ['Ruby'],
    ['Rune platelegs', 'Rune plateskirt'],
    ['Coins', 'Iron ore', 'Coal', 'Air rune', 'Water rune', 'Earth rune', 'Fire rune', 'Mind rune', 'Chaos rune', 'Death rune', 'Cosmic rune', 'Nature rune', 'Law rune']
];
const PRIORITIES = new Map(REWARDS.flatMap((names, rank) => names.map(name => [name.toLowerCase(), rank] as const)));

export function lootPriority(name: string | null): number {
    return PRIORITIES.get(name?.toLowerCase() ?? '') ?? Infinity;
}

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
    free: number;
    atChest: boolean;
    groundLoot: boolean;
    canLoot: boolean;
    pendingLoot: boolean;
    banking: boolean;
}

export type Step = { kind: 'drop' } | { kind: 'loot' } | { kind: 'open' } | { kind: 'travel' } | { kind: 'bank' };

export function decide(pack: PackState): Step {
    if (pack.banking) {
        return { kind: 'bank' };
    }
    if (pack.junk > 0) {
        return { kind: 'drop' };
    }
    if (pack.pendingLoot && !pack.atChest) {
        return { kind: 'travel' };
    }
    if (pack.atChest && pack.groundLoot) {
        return { kind: pack.canLoot ? 'loot' : 'bank' };
    }
    if (pack.keys > 0 && pack.free > 0) {
        return pack.atChest ? { kind: 'open' } : { kind: 'travel' };
    }
    return { kind: 'bank' };
}
