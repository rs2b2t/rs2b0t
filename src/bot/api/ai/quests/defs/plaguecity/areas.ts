import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface PlagueItem {
    id: number;
    name: string;
}

// Why: four of these display as "Door", two as "Stairs" and two as "Bucket", so every lookup that can collide goes through the id.
export const PC_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    SPADE: { id: 952, name: 'Spade' },
    ROPE: { id: 954, name: 'Rope' },
    BUCKET: { id: 1925, name: 'Bucket' },
    BUCKET_WATER: { id: 1929, name: 'Bucket of water' },
    BUCKET_MILK: { id: 1927, name: 'Bucket of milk' },
    CHOCOLATE_BAR: { id: 1973, name: 'Chocolate bar' },
    CHOCOLATE_DUST: { id: 1975, name: 'Chocolate dust' },
    CHOCOLATY_MILK: { id: 1977, name: 'Chocolaty milk' },
    PESTLE: { id: 233, name: 'Pestle and mortar' },
    SNAPE_GRASS: { id: 231, name: 'Snape grass' },
    DWELLBERRIES: { id: 2126, name: 'Dwellberries' },
    GAS_MASK: { id: 1506, name: 'Gas mask' },
    PICTURE: { id: 1510, name: 'Picture' },
    TURNIP_BOOK: { id: 1509, name: 'Book' },
    SCRUFFY_NOTE: { id: 1508, name: 'A scruffy note' },
    HANGOVER_CURE: { id: 1504, name: 'Hangover cure' },
    WARRANT: { id: 1503, name: 'Warrant' },
    ELENA_KEY: { id: 1507, name: 'A small key' },
    ARDOUGNE_SCROLL: { id: 1505, name: 'A magic scroll' }
} as const satisfies Record<string, PlagueItem>;

export const PC_NPC = {
    EDMOND: 'Edmond',
    ALRENA: 'Alrena',
    JETHICK: 'Jethick',
    TED: 'Ted Rehnison',
    MARTHA: 'Martha Rehnison',
    MILLI: 'Milli Rehnison',
    CLERK: 'Clerk',
    BRAVEK: 'Bravek',
    ELENA: 'Elena',
    MOURNER: 'Mourner'
} as const;

export const PC_LOC = {
    MUD_PATCH: [2531, 2532] as readonly number[],
    MUD_PILE: 2533,
    SEWER_PIPE: 2541,
    MANHOLE_SHUT: 2543,
    MANHOLE_OPEN: 2544,
    CUPBOARD_SHUT: 2524,
    CUPBOARD_OPEN: 2525,
    REHNISON_DOOR: 2537,
    REHNISON_STAIRS_UP: 2539,
    REHNISON_STAIRS_DOWN: 2540,
    PLAGUE_DOOR: 2535,
    BARREL: 2530,
    HOUSE_STAIRS_DOWN: 2522,
    HOUSE_STAIRS_UP: 2523,
    ELENA_GATE: 2526,
    BRAVEK_DOOR: 2528
} as const;

export const PC_TILE = {
    BANK: new Tile(2616, 3332, 0),
    EDMOND: new Tile(2568, 3334, 0),
    ALRENA: new Tile(2573, 3333, 0),
    HOUSE_FLOOR: new Tile(2575, 3333, 0),
    CUPBOARD: new Tile(2575, 3334, 0),
    GARDEN: new Tile(2566, 3330, 0),
    FOUNTAIN: new Tile(2629, 3311, 0),
    BUCKET_SPAWN: new Tile(2616, 3255, 0),
    COW_FIELD: new Tile(2664, 3346, 0),
    AEMAD: new Tile(2613, 3294, 0),
    DWELLBERRIES: new Tile(2645, 3498, 0),
    SNAPE_GRASS: new Tile(2906, 3297, 0),
    JATIX: new Tile(2899, 3427, 0),
    WYDIN: new Tile(3014, 3204, 0),
    SEWER_LANDING: new Tile(2562, 9737, 0),
    MUD_PILE: new Tile(2561, 9737, 0),
    SEWER_EDMOND: new Tile(2535, 9719, 0),
    SEWER_PIPE: new Tile(2530, 9703, 0),
    WEST_LANDING: new Tile(2529, 3304, 0),
    MANHOLE: new Tile(2529, 3303, 0),
    JETHICK: new Tile(2540, 3305, 0),
    REHNISON_DOOR: new Tile(2532, 3327, 0),
    REHNISON_TED: new Tile(2532, 3331, 0),
    REHNISON_STAIRS: new Tile(2528, 3332, 0),
    REHNISON_TOP: new Tile(2527, 3331, 1),
    MILLI: new Tile(2530, 3331, 1),
    // Why: `check_axis` grants this door's op only while the player's z equals its own, so the
    // stand is the door's own tile — a tile north answers the wrong branch and opens loc_2536.
    PLAGUE_DOOR: new Tile(2533, 3272, 0),
    PLAGUE_DOOR_INSIDE: new Tile(2533, 3271, 0),
    CLERK: new Tile(2529, 3317, 0),
    BRAVEK_DOOR: new Tile(2529, 3314, 0),
    BRAVEK: new Tile(2535, 3314, 0),
    BARREL: new Tile(2535, 3269, 0),
    HOUSE_STAIRS_DOWN: new Tile(2535, 3270, 0),
    HOUSE_STAIRS_UP: new Tile(2537, 9671, 0),
    ELENA_GATE: new Tile(2538, 9672, 0),
    ELENA: new Tile(2540, 9672, 0)
} as const;

export type PlagueArea = 'east' | 'sewer' | 'west' | 'upstairs' | 'cellar' | 'unknown';

export function plagueArea(tile: QuestSnapshot['tile']): PlagueArea {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    if (x >= 2528 && x <= 2548 && z >= 9655 && z <= 9688) {
        return 'cellar';
    }
    if (x >= 2490 && x <= 2600 && z >= 9690 && z <= 9770) {
        return 'sewer';
    }
    if (level === 1 && x >= 2520 && x <= 2540 && z >= 3322 && z <= 3340) {
        return 'upstairs';
    }
    if (level === 0 && x >= 2433 && x <= 2556 && z >= 3266 && z <= 3334) {
        return 'west';
    }
    return level === 0 ? 'east' : 'unknown';
}

export function held(snap: QuestSnapshot, item: PlagueItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: PlagueItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function owned(snap: QuestSnapshot, item: PlagueItem): number {
    return held(snap, item) + banked(snap, item);
}

export function worn(snap: QuestSnapshot, item: PlagueItem): boolean {
    return snap.wornIds?.has(item.id) ?? false;
}
