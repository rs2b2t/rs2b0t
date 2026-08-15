import Tile from '../../../../../geometry/Tile.js';

/** Every coordinate here was read out of the engine's own map spawns. */
export const DS_NPC = {
    GUILDMASTER: new Tile(3191, 3362, 0),
    OZIACH: new Tile(3069, 3517, 0),
    DUKE: new Tile(3212, 3220, 1),
    ORACLE: new Tile(3015, 3504, 0),
    WORMBRAIN: new Tile(3014, 3186, 0),
    /**
     * Outside his cell. The bars are `blockrange=no`, so the talk lands from
     * here on line of sight alone; no tile beside him is reachable.
     */
    WORMBRAIN_STAND: new Tile(3012, 3186, 0),
    KLARENSE: new Tile(3047, 3204, 0),
    NED: new Tile(3100, 3258, 0),
    MELZAR: new Tile(2929, 9649, 0),
    ELVARG: new Tile(2852, 9637, 0),
    /** Ned again, waiting on the top deck once the map is handed over. */
    NED_ABOARD: new Tile(3046, 9640, 3)
} as const;

export const DS_LOC = {
    MAZE_DOOR: new Tile(2941, 3248, 0),
    /** The maze ground floor also carries decoy ladders that refuse to be climbed. */
    MAZE_LADDER_DOWN: new Tile(2932, 3240, 0),
    RED_DOORS: [new Tile(2926, 3244, 0), new Tile(2926, 3248, 0), new Tile(2926, 3253, 0)],
    ORANGE_DOORS: [new Tile(2931, 3247, 1), new Tile(2931, 3250, 1), new Tile(2931, 3253, 1), new Tile(2931, 3256, 1)],
    YELLOW_DOORS: [new Tile(2924, 3249, 2), new Tile(2928, 3249, 2), new Tile(2931, 3249, 2), new Tile(2936, 3256, 2)],
    BLUE_DOOR: new Tile(2931, 9643, 0),
    MAGENTA_DOOR: new Tile(2929, 9652, 0),
    GREEN_DOOR: new Tile(2936, 9655, 0),
    MAZE_CHEST: new Tile(2935, 9657, 0),
    ORACLE_DOOR: new Tile(3051, 9840, 0),
    /** West of the magic door; opening it teleports you through to 3051. */
    ORACLE_DOOR_STAND: new Tile(3050, 9840, 0),
    ORACLE_CHEST: new Tile(3057, 9841, 0),
    /** The chest is forceapproach=north, and its own tile is blocked. */
    ORACLE_CHEST_STAND: new Tile(3057, 9842, 0),
    GANGPLANK: new Tile(3047, 3205, 1),
    /** Dockside, at ground level: the gangplank itself sits a level above. */
    GANGPLANK_STAND: new Tile(3047, 3204, 0),
    SHIP_LADDER: new Tile(3049, 3208, 1),
    SHIP_HOLE: new Tile(3047, 9639, 1),
    CRANDOR_ROCK: new Tile(2833, 3255, 0),
    // Why: the secret wall is one loc, spawned at angle 3 (south) on this tile in m44_150.jm2.
    // Why: both sides click this tile, as a wall has no second loc on its far side.
    // Why: the angle is what makes this row the one `check_axis_locactive` counts as "entering".
    CRANDOR_SECRET_DOOR: new Tile(2836, 9600, 0),
    // Why: this is a stand and not a loc — the wall is still the tile above.
    // Why: opening from here works only once it has been opened from the Crandor side, which is what sets %dragon_wall.
    SECRET_WALL_KARAMJA_STAND: new Tile(2836, 9599, 0),
    ELVARG_GATE: new Tile(2847, 9636, 0),
    ELVARG_GATE_STAND: new Tile(2846, 9637, 0),
    // Why: both leaves of this gate spawn at angle 0 (west) on x=2847, so `check_axis_locactive` counts the lair's own column as "entering".
    // Why: the lock therefore only ever guards the way in, and standing here is what lets a finished run back out.
    ELVARG_GATE_INSIDE: new Tile(2847, 9637, 0)
} as const;

/**
 * All six maze keys render as "Key" and all three map parts as "Map part", so
 * anything that has to tell them apart must go through the object id.
 */
export const DS_ID = {
    MAP_MELZAR: 1535,
    MAP_WORMBRAIN: 1536,
    MAP_ORACLE: 1537,
    MAP: 1538,
    NAILS: 1539,
    SHIELD: 1540,
    MAZE_KEY: 1542,
    RED_KEY: 1543,
    ORANGE_KEY: 1544,
    YELLOW_KEY: 1545,
    BLUE_KEY: 1546,
    MAGENTA_KEY: 1547,
    GREEN_KEY: 1548,
    PLANK: 960,
    HAMMER: 2347,
    MIND_BOMB: 1907,
    UNFIRED_BOWL: 1791,
    LOBSTER_POT: 301,
    SILK: 950
} as const;

/** Display names as the client renders them; several are not what they are called. */
export const DS_ITEM = {
    MAZE_KEY: 'Maze key',
    KEY: 'Key',
    MAP_PART: 'Map part',
    MAP: 'Crandor map',
    NAILS: 'Nails',
    PLANK: 'Plank',
    HAMMER: 'Hammer',
    SHIELD: 'Dragonfire shield',
    MIND_BOMB: "Wizard's mind bomb",
    UNFIRED_BOWL: 'Unfired bowl',
    LOBSTER_POT: 'Lobster pot',
    SILK: 'Silk'
} as const;

/** One plank and four nails per hole, three holes, and a hammer to drive them. */
export const SHIP_REPAIR = { planks: 3, nailsPerPlank: 4 } as const;

/** Wormbrain sells his piece; he is behind bars and cannot be reached in melee. */
export const WORMBRAIN_PRICE = 10_000;
export const SHIP_PRICE = 2000;
