import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const HD_QUEST = 'Horror from the Deep';

/** Exact `%horrorquest` values from quest_horror.constant + quest.constant. */
export const HD_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    ENTERED_LIGHTHOUSE: 2,
    FIXING_LIGHTHOUSE: 3,
    REPAIRED_LIGHTHOUSE: 4,
    DEFEATED_DAGJR: 5,
    COMPLETE: 10
} as const;

export const HD_ID = {
    KEY: 3848,
    CASKET: 3849,
    PLANK: 960,
    NAILS: 1539,
    HAMMER: 2347,
    SWAMP_TAR: 1939,
    MOLTEN_GLASS: 1775,
    TINDERBOX: 590,
    BARCRAWL_CARD: 455,
    AIR_RUNE: 556,
    WATER_RUNE: 555,
    EARTH_RUNE: 557,
    FIRE_RUNE: 554,
    CHAOS_RUNE: 562,
    DEATH_RUNE: 560,
    LAW_RUNE: 563,
    DAGGER: 1205,
    ARROW: 882,
    BUCKET: 1925,
    BUCKET_OF_SAND: 1783,
    SODA_ASH: 1781,
    SEAWEED: 401,
    STEEL_BAR: 2353,
    COINS: 995
} as const;

export const HD_ITEM = {
    KEY: 'Lighthouse key',
    CASKET: 'Rusty casket',
    PLANK: 'Plank',
    NAILS: 'Nails',
    HAMMER: 'Hammer',
    SWAMP_TAR: 'Swamp tar',
    MOLTEN_GLASS: 'Molten glass',
    TINDERBOX: 'Tinderbox',
    BARCRAWL_CARD: 'Barcrawl card',
    AIR_RUNE: 'Air rune',
    WATER_RUNE: 'Water rune',
    EARTH_RUNE: 'Earth rune',
    FIRE_RUNE: 'Fire rune',
    CHAOS_RUNE: 'Chaos rune',
    DEATH_RUNE: 'Death rune',
    LAW_RUNE: 'Law rune',
    DAGGER: 'Bronze dagger',
    ARROW: 'Bronze arrow',
    BUCKET: 'Bucket',
    BUCKET_OF_SAND: 'Bucket of sand',
    SODA_ASH: 'Soda ash',
    SEAWEED: 'Seaweed',
    COINS: 'Coins'
} as const;

/** Loc display names, from quest_horror.loc and barbarian_course.loc. */
export const HD_LOC = {
    BASALT: 'Basalt rock',
    BRIDGE: 'Broken bridge',
    PIPE: 'Obstacle pipe',
    DOORWAY: 'Doorway',
    STAIRS: 'Staircase',
    LADDER: 'Iron ladder',
    BOOKCASE: 'Bookcase',
    /** The broken cog carries **no ops at all** — it is a use-on target only. */
    LIGHT: 'Lighting mechanism',
    WALL: 'Strange wall',
    SAND_PIT: 'Sand pit',
    RANGE: 'Range',
    FURNACE: 'Furnace'
} as const;

// Why: the lighthouse exists twice — during the quest its interior is the broken copy in mapsquare 38_71.
// Why: repairing the light teleports the player by (+64,-960) into the live one in 39_56, and every staircase from there routes back into the copy.
// Why: nothing walks between them, as the doorway and the stairs teleport.
export const HD_TILE = {
    /** South shore of the causeway, one tile before the first basalt gap. */
    CAUSEWAY_SOUTH: new Tile(2522, 3594, 0),
    LARRISSA: new Tile(2508, 3635, 0),
    /** South of the lighthouse doorway at (2509,3636). */
    LIGHTHOUSE_DOOR: new Tile(2509, 3635, 0),
    BRIDGE_WEST: new Tile(2596, 3608, 0),
    BRIDGE_EAST: new Tile(2598, 3608, 0),

    /** Landing tile inside the broken copy, one north of its doorway. */
    QUEST_LIGHTHOUSE_L0: new Tile(2445, 4597, 0),
    QUEST_STAIRS_BASE: new Tile(2443, 4600, 0),
    QUEST_LADDER: new Tile(2444, 4603, 0),
    QUEST_STAIRS_L1: new Tile(2441, 4601, 1),
    QUEST_BOOKCASE: new Tile(2444, 4603, 1),
    QUEST_STAIRS_L2: new Tile(2441, 4601, 2),
    QUEST_LIGHT: new Tile(2443, 4598, 2),

    /** Lighthouse, where repairing the light drops the player. */
    REAL_STAIRS_L2: new Tile(2506, 3640, 2),
    REAL_LIGHTHOUSE_L0: new Tile(2509, 3637, 0),

    /** Lighthouse basement — a pocket of mapsquare 39_72 at level 1. */
    BASEMENT_LADDER: new Tile(2519, 4619, 1),
    /** South of the strange wall: the only side its slots can be loaded from. */
    WALL_SOUTH: new Tile(2515, 4626, 1),
    WALL_NORTH: new Tile(2515, 4628, 1),
    BASEMENT_DOWN: new Tile(2515, 4629, 1),

    CAVERN_LANDING: new Tile(2515, 4633, 0),
    JOSSIK: new Tile(2518, 4634, 0),

    /** Post-quest cavern the completion teleport drops the player into. */
    POSTQUEST_CAVERN: new Tile(2515, 10001, 1),
    /** Its own iron ladder, the only way out of that pocket. */
    POSTQUEST_LADDER: new Tile(2519, 9995, 1),

    OUTPOST_PIPE_NORTH: new Tile(2552, 3561, 0),
    OUTPOST_PIPE_SOUTH: new Tile(2552, 3558, 0),
    GUNNJORN: new Tile(2540, 3548, 0),
    /** Four `woodplank` ground spawns north-east of the outpost. */
    PLANK_SPAWNS: [
        new Tile(2552, 3574, 0),
        new Tile(2553, 3575, 0),
        new Tile(2554, 3574, 0),
        new Tile(2556, 3573, 0)
    ],

    /** Lumbridge swamp tar patch — the nearest spawns outside Morytania. */
    SWAMP_TAR: new Tile(3173, 3178, 0),
    // Why: Rellekka's north-east shore has nine seaweed spawns and is by a long way the nearest to the lighthouse.
    // Why: Catherby's beach spawns sit on an islet the walker cannot reach.
    SEAWEED: new Tile(2708, 3728, 0),
    /** Yanille: the sand pit and a Range stand seven tiles apart. */
    SAND_PIT: new Tile(2541, 3103, 0),
    /**
     * East of the Yanille range, which is `forceapproach=east` at angle 0 — so
     * east is east here, and the west side answers nothing at all.
     */
    YANILLE_RANGE: new Tile(2550, 3099, 0),
    // Why: Rellekka's furnace is nearer to everything this quest does and refuses anyone who has not finished The Fremennik Trials, so this is East Ardougne's.
    // Why: it is `forceapproach=east` placed at angle 2, so the only legal side is west in world space — the furnace itself spans (2601-2603,3310-3312).
    FURNACE: new Tile(2600, 3310, 0),

    VARROCK_SWORDSHOP: new Tile(3203, 3395, 0),
    VARROCK_ARCHERY: new Tile(3232, 3424, 0),
    VARROCK_RUNES: new Tile(3253, 3401, 0),
    VARROCK_GENERAL: new Tile(3218, 3415, 0)
} as const;

export const SWORD_SHOP = { npc: 'Shop keeper', anchor: HD_TILE.VARROCK_SWORDSHOP };
export const ARCHERY_SHOP = { npc: 'Lowe', anchor: HD_TILE.VARROCK_ARCHERY };
export const RUNE_SHOP = { npc: 'Aubury', anchor: HD_TILE.VARROCK_RUNES };
export const GENERAL_SHOP = { npc: 'Shop keeper', anchor: HD_TILE.VARROCK_GENERAL };

// Why: every bartender in the game renders "Bartender", so they are found by npc id.
// Why: `line` is the fragment of the card's own scroll for that bar, which is the only readable progress there is, as `%barcrawl` is not on the wire.

// The ten bars of Alfred Grimhand's barcrawl.
export const LARRISSA: NpcStop = {
    npc: 'Larrissa',
    anchor: HD_TILE.LARRISSA,
    leash: 8,
    prefer: [
        'With what?',
        'But how can I help?',
        "Okay, I'll help!",
        "I'll see what I can do",
        'How can I fix the bridge?',
        'Where is your cousin?'
    ]
};

export const GUNNJORN: NpcStop = {
    npc: 'Gunnjorn',
    anchor: HD_TILE.GUNNJORN,
    leash: 8,
    prefer: []
};

export const JOSSIK: NpcStop = {
    npc: 'Jossik',
    anchor: HD_TILE.JOSSIK,
    leash: 8,
    prefer: []
};

