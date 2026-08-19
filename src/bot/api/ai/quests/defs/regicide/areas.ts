import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface RegicideItem {
    id: number;
    name: string;
}

// Why: "Barrel bomb" is the display name of both the sealed barrel and the fused one, and "Naphtha mix" of
// both half-mixes — every lookup here goes through the id, never the name.
export const RG_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    SHARK: { id: 385, name: 'Shark' },
    COAL: { id: 453, name: 'Coal' },
    PICKAXE: { id: 1265, name: 'Bronze pickaxe' },
    PESTLE: { id: 233, name: 'Pestle and mortar' },
    POT: { id: 1931, name: 'Pot' },
    BALL_OF_WOOL: { id: 1759, name: 'Ball of wool' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    SPADE: { id: 952, name: 'Spade' },
    SHORTBOW: { id: 841, name: 'Shortbow' },
    BRONZE_ARROW: { id: 882, name: 'Bronze arrow' },
    ROPE: { id: 954, name: 'Rope' },
    LOGS: { id: 1511, name: 'Logs' },
    RAW_RABBIT: { id: 3226, name: 'Raw rabbit' },
    COOKED_RABBIT: { id: 3228, name: 'Cooked rabbit' },
    SUMMONS: { id: 3206, name: "King's message" },
    MESSAGE: { id: 3207, name: 'Iorwerths message' },
    PENDANT: { id: 3208, name: 'Crystal pendant' },
    SULPHUR: { id: 3209, name: 'Sulphur' },
    LIMESTONE: { id: 3211, name: 'Limestone' },
    QUICKLIME: { id: 3213, name: 'Quicklime' },
    QUICKLIME_DUST: { id: 3214, name: 'Pot of quicklime' },
    SULPHUR_DUST: { id: 3215, name: 'Ground sulphur' },
    BARREL: { id: 3216, name: 'Barrel' },
    BARREL_LID: { id: 3218, name: 'Barrel bomb' },
    BARREL_FUSED: { id: 3219, name: 'Barrel bomb' },
    BARREL_TAR: { id: 3220, name: 'Barrel of coal-tar' },
    BARREL_NAPHTHA: { id: 3221, name: 'Barrel of naphtha' },
    MIX_SULPHUR: { id: 3222, name: 'Naphtha mix' },
    MIX_QUICKLIME: { id: 3223, name: 'Naphtha mix' },
    CLOTH: { id: 3224, name: 'Cloth' },
    BOOK: { id: 3230, name: 'Big book of bangs' }
} as const satisfies Record<string, RegicideItem>;

/** Either half-mix — the two are the same step from opposite sides. */
export const RG_MIXES: readonly RegicideItem[] = [RG_ITEM.MIX_QUICKLIME, RG_ITEM.MIX_SULPHUR];

export const RG_NPC = {
    MESSENGER: 1210,
    IORWERTH: 1182,
    TRACKER: 1199,
    OLD_CAMP_GUARD: 1200,
    CAMP_GUARD: 1203,
    LAZY_GUARD: 1205,
    ARIANWYN: 1202,
    RABBIT: 1192,
    QUARTERMASTER: 1208
} as const;

export const RG_LOC = {
    WELL_OF_VOYAGE: 4004,
    WELL_BACK: 4005,
    TEMPLE_ENTRANCE: 4006,
    TEMPLE_EXIT: 4007,
    FOOTPRINTS: 3941,
    LOOM: 787,
    FURNACE: 3994,
    TAR: 3975,
    SULPHUR1: 3962,
    SULPHUR2: 3963,
    SULPHUR3: 3964,
    STILL: 4026,
    CATAPULT: 3976,
    /** The ordinary furnace pair — `regicide_heat_quicklime` hangs off the generic `use_furnace` switch. */
    FURNACE_MAIN: 2781,
    FURNACE_SIDE: 2785,
    LIMESTONE1: 4029,
    LIMESTONE2: 4028,
    LIMESTONE3: 4027,
    GATE_LEFT: 3945,
    GATE_RIGHT: 3944
} as const;

export const RG_SULPHUR_LOCS: readonly number[] = [RG_LOC.SULPHUR1, RG_LOC.SULPHUR2, RG_LOC.SULPHUR3];
export const RG_LIMESTONE_LOCS: readonly number[] = [RG_LOC.LIMESTONE1, RG_LOC.LIMESTONE2, RG_LOC.LIMESTONE3];

// Why: every tile here is a STAND, never a multi-tile loc's own origin — walking to an origin inside a
// footprint fails outright and reads as a missing loc.
export const RG_TILE = {
    ARDOUGNE_BANK: new Tile(2655, 3283, 0),
    /** The range beside the Ardougne bank, where the rabbit for the catapult guard is cooked. */
    ARDOUGNE_RANGE: new Tile(2648, 3298, 0),
    /** East Ardougne's furnace, which is where the limestone is burned on the way to the still. */
    ARDOUGNE_FURNACE: new Tile(2601, 3309, 0),
    LATHAS: new Tile(2578, 3293, 1),

    /** Iban's temple door — at `%regicide_quest >= 2` it hops the player to the Well of Voyage room. */
    IBAN_DOOR: new Tile(2145, 4647, 1),
    WELL_ROOM: new Tile(2015, 4711, 1),
    WELL_OF_VOYAGE: new Tile(2009, 4711, 1),
    VOYAGE_TEMPLE: new Tile(2343, 9622, 0),
    VOYAGE_EXIT: new Tile(2313, 9623, 0),
    ISAFDAR_ENTRY: new Tile(2312, 3216, 0),
    VOYAGE_ENTRANCE: new Tile(2314, 3215, 0),

    IORWERTH: new Tile(2205, 3252, 0),
    LOOM: new Tile(2199, 3249, 0),
    BARREL_SPAWN: new Tile(2205, 3257, 0),
    POT_SPAWN: new Tile(2199, 3257, 0),
    TRACKER: new Tile(2257, 3149, 0),
    FOOTPRINTS: new Tile(2240, 3151, 0),
    TAR: new Tile(2263, 3128, 0),
    SULPHUR: new Tile(2256, 3127, 0),
    OLD_CAMP_WEST: new Tile(2231, 3149, 0),
    CATAPULT: new Tile(2185, 3182, 0),
    LAZY_GUARD: new Tile(2181, 3184, 0),
    CAMP_ENTRANCE: new Tile(2188, 3171, 0),
    /** The far side of the camp crossing — taking it is what sets `^regicide_entered_camp`. */
    CAMP_INSIDE: new Tile(2188, 3168, 0),
    TYRAS_CAMP: new Tile(2188, 3162, 0),
    FURNACE: new Tile(2193, 3147, 0),
    QUARTERMASTER: new Tile(2190, 3155, 0),
    QUARRY: new Tile(2323, 3269, 0),
    RABBITS: new Tile(2230, 3238, 0),

    ARANDAR_SOUTH: new Tile(2384, 3331, 0),
    ARANDAR_NORTH: new Tile(2384, 3337, 0),
    STILL: new Tile(2927, 3211, 0),
    CHEMIST: new Tile(2934, 3210, 0)
} as const;

/** Where the player is, at the coarse grain the module's legs branch on. */
export type RegicideArea = 'mainland' | 'pass' | 'voyage' | 'tirannwn' | 'pit' | 'unknown';

// Why: the pitfalls drop the player into mapsquare 36_150 alongside the voyage temple, so the two are told
// apart by z — the temple sits at 9620-9635 and every spike pit below it at 9640-9660.
const VOYAGE_MAX_Z = 9635;

export function regicideArea(tile: QuestSnapshot['tile']): RegicideArea {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    if (x >= 2304 && x <= 2367 && z >= 9600 && z <= 9663) {
        return z <= VOYAGE_MAX_Z ? 'voyage' : 'pit';
    }
    if (z >= 4500) {
        return 'pass';
    }
    // Why: Tirannwn is everything west and south of the Arandar palisade, which is the only join to the
    // rest of the map — the box is the two mapsquare columns the forest occupies plus the Arandar pass.
    if (level === 0 && x >= 2160 && x <= 2390 && z >= 3110 && z <= 3334) {
        return 'tirannwn';
    }
    return 'mainland';
}

export function held(snap: QuestSnapshot, item: RegicideItem): number {
    return snap.invIds?.get(item.id) ?? 0;
}

export function banked(snap: QuestSnapshot, item: RegicideItem): number {
    return snap.bankIds?.get(item.id) ?? 0;
}

export function worn(snap: QuestSnapshot, item: RegicideItem): boolean {
    return snap.wornIds?.has(item.id) ?? false;
}

export function carried(snap: QuestSnapshot, item: RegicideItem): number {
    return held(snap, item) + (worn(snap, item) ? 1 : 0);
}

export function owned(snap: QuestSnapshot, item: RegicideItem): number {
    return held(snap, item) + banked(snap, item);
}

/** How many of a set the pack holds — the two half-mixes share a display name. */
export function countHeld(snap: QuestSnapshot, items: readonly RegicideItem[]): number {
    return items.filter(item => held(snap, item) > 0).length;
}
