import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const OBS_QUEST = 'Observatory Quest';

/** Exact `%itgronigen` values from quest_itgronigen.constant + quest.constant. */
export const OBS_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    GIVEN_PLANKS: 2,
    GIVEN_BRONZE: 3,
    GIVEN_GLASS: 4,
    GIVEN_MOULD: 5,
    SENT_TELESCOPE: 6,
    COMPLETE: 7
} as const;

export const OBS_ID = {
    PLANK: 960,
    BRONZE_BAR: 2349,
    MOLTEN_GLASS: 1775,
    LENS_MOULD: 602,
    LENS: 603,
    KEEP_KEY: 601,
    SEAWEED: 401,
    SODA_ASH: 1781,
    BUCKET_OF_SAND: 1783,
    COPPER_ORE: 436,
    TIN_ORE: 438,
    BRONZE_PICKAXE: 1265,
    COINS: 995
} as const;

export const OBS_ITEM = {
    PLANK: 'Plank',
    BRONZE_BAR: 'Bronze bar',
    MOLTEN_GLASS: 'Molten glass',
    LENS_MOULD: 'Lens mould',
    LENS: 'Lens',
    KEEP_KEY: 'Keep key',
    SEAWEED: 'Seaweed',
    SODA_ASH: 'Soda ash',
    BUCKET_OF_SAND: 'Bucket of sand',
    COPPER_ORE: 'Copper ore',
    TIN_ORE: 'Tin ore',
    BRONZE_PICKAXE: 'Bronze pickaxe'
} as const;

/** Three planks, one bar, one glass — the professor counts each hand-over himself. */
export const PLANKS_NEEDED = 3;

// Why: eight of the cavern's locs render "Chest" and six of them are `shutdungeonchest`, which spawns a poisonous spider on Search, so every lookup down here is by id.
export const OBS_LOC = {
    RECEPTION_LADDER: 2187,
    KEY_CHEST_SHUT: 2197,
    KEY_CHEST_OPEN: 2198,
    /** `keepgate_closed` and its mirrored left half; both answer `_observatory_dungeon_gate`. */
    GATE_RIGHT: 2199,
    GATE_LEFT: 2200,
    SACK: 2212,
    TELESCOPE: 2210
} as const;

export const OBS_LOC_NAME = {
    LADDER: 'Ladder',
    CHEST: 'Chest',
    GATE: 'Keep gate',
    SACK: 'Sack',
    TELESCOPE: 'Telescope',
    RANGE: 'Range',
    FURNACE: 'Furnace'
} as const;

// Why: the reception, the cavern and the dome are three pockets of one map — the dome is walled off from the surface, so its only door is the cavern below it.
export const OBS_TILE = {
    /** Observatory reception: the professor takes every hand-over here. */
    PROFESSOR: new Tile(2438, 3186, 0),
    /** North of the reception's Climb-down ladder at (2444,3191). */
    RECEPTION_LADDER: new Tile(2444, 3192, 0),
    /** Where `p_telejump` drops the player, one north of the cavern's exit ladder. */
    DUNGEON_LANDING: new Tile(2420, 9459, 0),

    /** South of `loc_2197`, the one chest in the cavern that holds the keep key. */
    KEY_CHEST_STAND: new Tile(2428, 9418, 0),
    /** North of the keep gate — the locked side, and where the goblin guard stands. */
    GATE_NORTH: new Tile(2390, 9458, 0),
    /** South of the gate, inside the keep. */
    GATE_SOUTH: new Tile(2390, 9457, 0),
    // Why: the keep is one walkable column at x 2390 — a `smashedtable` fills (2389,9455) and the sack itself (2389,9454), so this is the sack's only cardinal neighbour.
    SACK_STAND: new Tile(2390, 9454, 0),

    /** Foot of the cavern ladder that climbs into the dome. */
    DOME_LADDER_FOOT: new Tile(2423, 9440, 0),
    /** Where that ladder arrives, inside the dome's walls. */
    DOME_ARRIVE: new Tile(2440, 3165, 0),
    /** North of the telescope at (2440,3157) and four tiles from the professor's dome copy. */
    TELESCOPE_STAND: new Tile(2440, 3159, 0),

    /** The lone `bucket_sand` spawn, twenty-five tiles east of the reception. */
    SAND_SPAWN: new Tile(2461, 3178, 0),
    // Why: these two are Horror from the Deep's, already walked live — four plank spawns north-east of the Barbarian Outpost, and the nine-spawn seaweed shore.
    PLANK_SPAWNS: [
        new Tile(2552, 3574, 0),
        new Tile(2553, 3575, 0),
        new Tile(2554, 3574, 0),
        new Tile(2556, 3573, 0)
    ],
    SEAWEED_SPAWN: new Tile(2708, 3728, 0),

    /** Copper and tin in one seam; the stand is clear of the rocks themselves. */
    MINE: new Tile(2631, 3146, 0),
    // Why: `furnace1` is `forceapproach=east` placed at angle 2, so the only legal side is west in world space — the furnace spans (2601-2603,3310-3312).
    FURNACE: new Tile(2600, 3310, 0),
    // Why: every Range is `forceapproach=east` and the two nearer Ardougne ones are placed at angle 2, which puts their legal side inside a house — a use-on from anywhere else is dropped in silence.
    // Why: this is the Fishing Guild range south of the fence, whose stand the fishing cook loops already prove, and it sits on the walk home from the shore.
    RANGE_LOC: new Tile(2616, 3396, 0),
    RANGE_STAND: new Tile(2616, 3395, 0),

    BANK: new Tile(2655, 3283, 0)
} as const;

export const PROFESSOR: NpcStop = {
    npc: 'Observatory professor',
    anchor: OBS_TILE.PROFESSOR,
    leash: 6,
    prefer: [
        "I'd like to have a look through that telescope.",
        'Sounds interesting, what can I do for you?'
    ]
};

/** The dome copy of the professor — the telescope only answers while he is within seven tiles. */
export const PROFESSOR_DOME = 'Observatory professor';

/** Everything the module ever wants to keep through a spillover deposit. */
export const OBSERVATORY_TOOLS: readonly string[] = [
    'coins', 'plank', 'bronze bar', 'molten glass', 'lens mould', 'lens', 'keep key',
    'seaweed', 'soda ash', 'bucket of sand', 'copper ore', 'tin ore', 'pickaxe'
];
