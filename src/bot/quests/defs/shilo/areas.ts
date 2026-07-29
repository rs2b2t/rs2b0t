// docs/superpowers/specs/2026-07-29-shilo-village-design.md
import Tile from '../../../api/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface ShiloItem {
    id: number;
    name: string;
}

// Engine names, not wiki ones. Several are misspelled in the configs ("Rashiliya
// corpse", "Stone-plaque") and the five Jungle Potion unids all render as
// "Unidentified herb", so every lookup here goes through the id.
export const SV_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    ROPE: { id: 954, name: 'Rope' },
    SPADE: { id: 952, name: 'Spade' },
    CHISEL: { id: 1755, name: 'Chisel' },
    HAMMER: { id: 2347, name: 'Hammer' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    CANDLE: { id: 36, name: 'Candle' },
    LIT_CANDLE: { id: 33, name: 'Lit candle' },
    BRONZE_BAR: { id: 2349, name: 'Bronze bar' },
    BRONZE_WIRE: { id: 1794, name: 'Bronze wire' },
    BONES: { id: 526, name: 'Bones' },
    WAMPUM_BELT: { id: 625, name: 'Wampum belt' },
    TATTERED_SCROLL: { id: 607, name: 'Tattered scroll' },
    CRUMPLED_SCROLL: { id: 608, name: 'Crumpled scroll' },
    ZADIMUS_CORPSE: { id: 610, name: 'Zadimus corpse' },
    BONE_SHARD: { id: 604, name: 'Bone shard' },
    BONE_KEY: { id: 605, name: 'Bone key' },
    SWORD_POMMEL: { id: 623, name: 'Sword pommel' },
    BONE_BEADS: { id: 618, name: 'Bone beads' },
    DEAD_BEADS: { id: 616, name: 'Beads of the dead' },
    RASH_CORPSE: { id: 609, name: 'Rashiliya corpse' }
} as const satisfies Record<string, ShiloItem>;

export const SV_LOC = {
    MOUND: 'Mound of earth',
    FISSURE: 'Fissure',
    CAVE_IN: 'Cave in',
    LOOSE_ROCKS: 'Loose rocks',
    OLD_SACKS: 'Old sacks',
    GALLOWS: 'Ancient gallows',
    WATERFALL_ROCKS: 'Waterfall rocks',
    WELL_STACKED_ROCKS: 'Well stacked rocks',
    BERVIRIUS_DOLMEN: 'Tomb dolmen',
    HANDHOLDS: 'Climbing rocks',
    PALM_TREE: 'Palm tree',
    CARVED_DOORS: 'Carved doors',
    HILLSIDE_ENTRANCE: 'Hillside entrance',
    TOMB_EXIT: 'Tomb exit',
    ANCIENT_GATE: 'Ancient metal gate',
    RASH_ROCKS: 'Rocks',
    TOMB_DOORS: 'Tomb doors',
    RASH_DOLMEN: 'Tomb dolmen'
} as const;

export const SV_NPC = {
    MOSOL_REI: 'Mosol Rei',
    TRUFITUS: 'Trufitus',
    JIMINUA: 'Jiminua',
    NAZASTAROOL: 'Nazastarool',
    RASHILIYIA: 'Rashiliyia',
    UNDEAD_ONE: 'Undead One'
} as const;

/**
 * Stand tiles are the walkable neighbour of each loc, taken from the baked pack —
 * most of these locs are multi-tile blockers whose own coordinate is unwalkable.
 */
export const SV_TILE = {
    ARDOUGNE_BANK: new Tile(2616, 3332, 0),
    JIMINUA: new Tile(2767, 3122, 0),
    ANVIL: new Tile(2790, 3101, 0),
    TRUFITUS: new Tile(2809, 3086, 0),
    MOSOL_REI: new Tile(2883, 2951, 0),
    // Anywhere inside 2794-2798 x 3087-3090 counts as sacred for the burial.
    SACRED_GROUND: new Tile(2796, 3088, 0),

    MOUND_STAND: new Tile(2921, 2998, 0),

    CAVE_IN_NORTH: new Tile(2887, 9374, 0),
    CAVE_IN_SOUTH: new Tile(2888, 9283, 0),
    LOOSE_ROCKS: new Tile(2886, 9317, 0),
    OLD_SACKS: new Tile(2938, 9285, 0),
    GALLOWS: new Tile(2933, 9325, 0),
    WATERFALL_ROCKS: new Tile(2939, 9349, 0),

    WELL_STACKED_ROCKS: new Tile(2762, 2989, 0),
    BERVIRIUS_DOLMEN: new Tile(2765, 9364, 0),
    HANDHOLDS: new Tile(2764, 9376, 0),

    PALM_TREES: new Tile(2914, 3092, 0),
    // West of the doors, cardinally adjacent. The pack was baked with the jungle
    // plants that hide them, not with the doors, so nothing east of (2916,3090) is
    // a stand the walker can actually reach.
    CARVED_DOORS: new Tile(2915, 3090, 0),
    TOMB_EXIT: new Tile(2928, 9526, 0),
    ANCIENT_GATE: new Tile(2929, 9517, 0),
    RASH_ROCKS_BOTTOM: new Tile(2928, 9511, 0),
    // South of the skeletal doors, which is the side the climbing rocks drop you
    // on. The dolmen is behind them: three bones is the only way through.
    TOMB_DOORS: new Tile(2892, 9479, 0),
    TOMB_DOORS_INSIDE: new Tile(2892, 9482, 0),
    RASH_DOLMEN: new Tile(2891, 9487, 0)
} as const;

/**
 * The dolmen room, behind the skeletal doors. A plain z test cannot stand in for
 * this: the corridor east of the doors runs up to z=9511 on the *southern* side.
 */
export function inDolmenRoom(tile: QuestSnapshot['tile']): boolean {
    return tile !== null && tile !== undefined
        && tile.x >= 2886 && tile.x <= 2898 && tile.z >= 9481 && tile.z <= 9492;
}

/** Bones are sold nowhere and dropped by nothing this quest kills. */
export const BONE_SPAWNS: readonly Tile[] = [
    new Tile(2484, 3221, 0),
    new Tile(2480, 3219, 0),
    new Tile(2476, 3224, 0),
    new Tile(2470, 3223, 0),
    new Tile(2466, 3226, 0),
    new Tile(2470, 3217, 0)
];

export type ShiloArea =
    | 'karamja'
    | 'ahZaRhoonNorth'
    | 'ahZaRhoonSouth'
    | 'berviriusTomb'
    | 'rashEntry'
    | 'rashLedge'
    | 'rashInner'
    | 'shiloVillage'
    | 'unknown';

/** The gate sits at z=9516 and the rocks run 9511-9515, so the ledge is what's between. */
const RASH_GATE_Z = 9516;
const RASH_ROCKS_BOTTOM_Z = 9511;

/**
 * Every underground area here sits in its own mapsquare, and Rashiliyia's tomb has
 * three parts, not two: the corridor from the hillside doors, the ledge the gate
 * drops you onto, and the tomb below the climbing rocks. Collapsing the ledge into
 * either neighbour makes the gate open and re-open forever.
 */
export function shiloArea(tile: QuestSnapshot['tile']): ShiloArea {
    if (!tile) return 'unknown';
    const { x, z } = tile;
    if (x >= 2880 && x <= 2943 && z >= 9472 && z <= 9535) {
        if (z >= RASH_GATE_Z) return 'rashEntry';
        return z > RASH_ROCKS_BOTTOM_Z ? 'rashLedge' : 'rashInner';
    }
    if (x >= 2880 && x <= 2943 && z >= 9344 && z <= 9407) return 'ahZaRhoonNorth';
    if (x >= 2880 && x <= 2943 && z >= 9280 && z <= 9343) return 'ahZaRhoonSouth';
    if (x >= 2752 && x <= 2815 && z >= 9344 && z <= 9407) return 'berviriusTomb';
    if (z >= 4000) return 'unknown';
    if (x >= 2830 && x <= 2880 && z >= 2930 && z <= 2975) return 'shiloVillage';
    return 'karamja';
}
