import Tile from '../../../../../geometry/Tile.js';

export const FC_QUEST = 'Family Crest';

/** Mirrors quest_crest.constant. */
export const FC_STAGE = {
    NOT_STARTED: 0,
    SPOKEN_DIMINTHEIS: 1,
    SPOKEN_CALEB: 2,
    CALEB_PIECE: 3,
    CALEB_WHERE: 4,
    SPOKEN_GEM_TRADER: 5,
    SPOKEN_AVAN: 6,
    SPOKEN_BOOT: 7,
    AVAN_PIECE: 8,
    SPOKEN_JOHNATHON: 9,
    CURED_JOHNATHON: 10,
    COMPLETE: 11
} as const;

// Why: all three crest fragments render "Crest part", so every check goes through the id.
// Why: the names are crossed over server-side — Caleb hands out `avan_crest` and Avan hands out `caleb_crest`.
// Why: the constants below are named for the brother who gives them, which is what `decide()` reasons about.
export const FC_ID = {
    CREST_FROM_CALEB: 779,
    CREST_FROM_AVAN: 780,
    CREST_FROM_CHRONOZON: 781,
    FAMILY_CREST: 782,

    PERFECT_GOLD_ORE: 446,
    PERFECT_GOLD_BAR: 2365,
    PERFECT_RUBY_RING: 773,
    PERFECT_RUBY_NECKLACE: 774,
    RUBY: 1603,
    RING_MOULD: 1592,
    NECKLACE_MOULD: 1597,

    SWORDFISH: 373,
    BASS: 365,
    TUNA: 361,
    SALMON: 329,
    SHRIMP: 315,

    ANTIPOISON_4: 2446,
    ANTIPOISON_3: 175,
    ANTIPOISON_2: 177,
    ANTIPOISON_1: 179,

    LAW_RUNE: 563,
    AIR_RUNE: 556,
    WATER_RUNE: 555,
    EARTH_RUNE: 557,
    FIRE_RUNE: 554,
    DEATH_RUNE: 560,

    COINS: 995
} as const;

/** Display names as the client renders them. */
export const FC_ITEM = {
    CREST_PART: 'Crest part',
    FAMILY_CREST: 'Family crest',
    PERFECT_GOLD_ORE: "'perfect' gold ore",
    PERFECT_GOLD_BAR: "'perfect' gold bar",
    PERFECT_RUBY_RING: "'perfect' ring",
    PERFECT_RUBY_NECKLACE: "'perfect' necklace",
    RUBY: 'Ruby',
    RING_MOULD: 'Ring mould',
    NECKLACE_MOULD: 'Necklace mould',
    SWORDFISH: 'Swordfish',
    BASS: 'Bass',
    TUNA: 'Tuna',
    SALMON: 'Salmon',
    SHRIMP: 'Shrimps',
    LAW_RUNE: 'Law rune',
    AIR_RUNE: 'Air rune',
    WATER_RUNE: 'Water rune',
    EARTH_RUNE: 'Earth rune',
    FIRE_RUNE: 'Fire rune',
    DEATH_RUNE: 'Death rune',
    COINS: 'Coins'
} as const;

// Why: the navigator rubs jewellery from the inventory only and its bank planner never withdraws a ring, so the quest has to carry one for the Duel Arena hop to be planned at all.

// Ring of dueling, all eight charge stages.
export const DUEL_RING_IDS = [2552, 2554, 2556, 2558, 2560, 2562, 2564, 2566] as const;

/** Antipoison in every dose; any of them cures Johnathon. */
export const ANTIPOISON_IDS = [FC_ID.ANTIPOISON_4, FC_ID.ANTIPOISON_3, FC_ID.ANTIPOISON_2, FC_ID.ANTIPOISON_1] as const;

export const PICKAXES = [
    { id: 1275, name: 'Rune pickaxe' },
    { id: 1271, name: 'Adamant pickaxe' },
    { id: 1273, name: 'Mithril pickaxe' },
    { id: 1269, name: 'Steel pickaxe' },
    { id: 1267, name: 'Iron pickaxe' },
    { id: 1265, name: 'Bronze pickaxe' }
] as const;

/** Every coordinate here was read out of the engine's own map spawns. */
export const FC_NPC = {
    DIMINTHEIS: new Tile(3279, 3404, 0),
    CALEB: new Tile(2819, 3451, 0),
    GEM_TRADER: new Tile(3288, 3212, 0),
    /**
     * Avan's NPC renders as "Man" (`vislevel=hide`), and Al Kharid is full of
     * them — he is only ever found by npc id 663.
     */
    AVAN: new Tile(3295, 3285, 0),
    AVAN_NPC_ID: 663,
    BOOT: new Tile(2965, 9811, 0),
    /** Jolly Boar Inn, upstairs. */
    JOHNATHON: new Tile(3279, 3503, 1),
    CHRONOZON: new Tile(3087, 9937, 0),
    CHRONOZON_NPC_ID: 667
} as const;

export const FC_SHOP = {
    /** Aubury — air/water/earth/fire and death runes. */
    AUBURY: { npc: 'Aubury', anchor: new Tile(3253, 3401, 0) },
    /** Dommik — ring mould, necklace mould, chisel. */
    DOMMIK: { npc: 'Dommik', anchor: new Tile(3322, 3194, 0) },
    /** The only shop in the game holding a cut ruby, and it holds one. */
    GEM_MERCHANT: { npc: 'Gem merchant', anchor: new Tile(2669, 3303, 0) },
    /** Jiminua's Jungle Store — the only antipoison on sale anywhere. */
    JIMINUA: { npc: 'Jiminua', anchor: new Tile(2767, 3122, 0) },
    /** Nurmof — pickaxes, and already on the way past Boot. */
    NURMOF: { npc: 'Nurmof', anchor: new Tile(2997, 9844, 0) }
} as const;

export const FC_LOC = {
    /** Witchaven cellar ladder down into the perfect-gold mine. */
    MINE_LADDER: new Tile(2696, 3282, 0),
    MINE_LANDING: new Tile(2696, 9683, 0),
    /** Nearest furnace to the mine: East Ardougne. */
    FURNACE: new Tile(2601, 3310, 0),
    /** Inside the perfect-gold zone, clear of both hellhound spawns. */
    GOLD_ROCK: new Tile(2740, 9684, 0),
    GOLD_STAND: new Tile(2739, 9684, 0)
} as const;

export const FC_BANK = {
    VARROCK_EAST: new Tile(3253, 3420, 0),
    CATHERBY: new Tile(2809, 3441, 0),
    AL_KHARID: new Tile(3269, 3167, 0),
    ARDOUGNE_EAST: new Tile(2655, 3283, 0),
    FALADOR_EAST: new Tile(3013, 3355, 0),
    EDGEVILLE: new Tile(3094, 3493, 0)
} as const;

// Why: `inzone` tests the player's tile rather than the rock's, so mining a boundary rock from outside the box yields ordinary gold ore and the quest silently stalls.

// The perfect-gold zone from quest_crest.constant.
const PERFECT_GOLD_ZONE = { minX: 2736, maxX: 2740, minZ: 9684, maxZ: 9693 } as const;

export function inPerfectGoldZone(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    if (!tile || tile.level !== 0) {
        return false;
    }
    return tile.x >= PERFECT_GOLD_ZONE.minX && tile.x <= PERFECT_GOLD_ZONE.maxX
        && tile.z >= PERFECT_GOLD_ZONE.minZ && tile.z <= PERFECT_GOLD_ZONE.maxZ;
}

/** Chronozon's half of the Edgeville dungeon, past the poison-spider gates. */
export function inChronozonLair(tile: { x: number; z: number; level: number } | null | undefined): boolean {
    if (!tile || tile.level !== 0) {
        return false;
    }
    return tile.x >= 3072 && tile.x <= 3135 && tile.z >= 9920 && tile.z <= 9983;
}
