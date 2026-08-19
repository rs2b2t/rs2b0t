import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const SM_QUEST = 'Shades of Mortton';

/** `%morttonquest`, from quest_mortton.constant. */
export const SM_STAGE = {
    NOT_STARTED: 0,
    READ_DIARY: 5,
    MADE_SERUM: 10,
    KILL_SHADES: 15,
    KILLED_1: 20,
    KILLED_2: 25,
    KILLED_3: 30,
    KILLED_4: 35,
    KILLED_5: 40,
    SHADES_TO_RAZMIRE: 45,
    SHADES_TO_ULSQUIRE: 47,
    ULSQUIRE_TEMPLE: 50,
    REBUILD_TEMPLE: 55,
    CAN_LIGHT_ALTAR: 60,
    CREATED_SACRED_OIL: 65,
    CREATED_PYRE_LOGS: 70,
    LOGS_ON_PYRE: 75,
    LIT_PYRE: 80,
    COMPLETE: 85
} as const;

// Why: `%morttonquest` is not transmitted, but the three flamtaer meters are, so the temple leg reads its own progress off varps rather than flashing the journal every tick.

/** Transmitted flamtaer meters, 0–100. */
export const SM_VARP = {
    TEMPLE_REPAIRED: 343,
    TEMPLE_RESOURCES: 344,
    TEMPLE_SANCTITY: 345
} as const;

export const SM_ID = {
    COINS: 995,
    DIARY: 3395,
    UNID_TARROMIN: 203,
    TARROMIN: 253,
    TARROMIN_UNF: 95,
    VIAL_WATER: 227,
    VIAL_EMPTY: 229,
    ASHES: 592,
    ASHES_VIAL: 3406,
    SERUM4: 3408,
    SERUM3: 3410,
    SERUM2: 3412,
    SERUM1: 3414,
    SERUM_PERM4: 3416,
    SERUM_PERM3: 3417,
    SERUM_PERM2: 3418,
    SERUM_PERM1: 3419,
    REMAINS: 3396,
    LIMESTONE_BRICK: 3420,
    PLANK: 960,
    SWAMP_PASTE: 1941,
    OLIVE_OIL4: 3422,
    OLIVE_OIL3: 3424,
    OLIVE_OIL2: 3426,
    OLIVE_OIL1: 3428,
    SACRED_OIL4: 3430,
    SACRED_OIL3: 3432,
    SACRED_OIL2: 3434,
    SACRED_OIL1: 3436,
    LOGS: 1511,
    PYRE_LOGS: 3438,
    HAMMER: 2347,
    TINDERBOX: 590,
    /** What a Mort Myre ghast leaves where a lobster was. */
    ROTTEN_FOOD: 2959,
    /** The third herb the smashed table gives up, which this quest has no use for. */
    UNID_ROGUES_PURSE: 1533
} as const;

export const SM_NAME = {
    COINS: 'Coins',
    DIARY: 'Diary',
    TARROMIN: 'Tarromin',
    VIAL_WATER: 'Vial of water',
    VIAL_EMPTY: 'Vial',
    ASHES: 'Ashes',
    REMAINS: 'Loar remains',
    LIMESTONE_BRICK: 'Limestone brick',
    PLANK: 'Plank',
    SWAMP_PASTE: 'Swamp paste',
    OLIVE_OIL3: 'Olive oil(3)',
    LOGS: 'Logs',
    PYRE_LOGS: 'Pyre logs',
    HAMMER: 'Hammer',
    TINDERBOX: 'Tinderbox'
} as const;

export const SM_LOC = {
    SHELF: 'Shelf',
    TABLE: 'Smashed table',
    SINK: 'Sink',
    DEAD_TREE: 'Dead tree',
    BROKEN_WALL: 'Broken Wall',
    TEMPLE_WALL: 'Temple wall',
    ALTAR_UNLIT: 'Fire altar',
    ALTAR_LIT: 'Flaming Fire altar',
    ALTAR_BROKEN: 'Broken fire altar',
    PYRE: 'Funeral Pyre'
} as const;

export const SM_LOC_ID = {
    SHELF: 4062,
    TABLE: 4064,
    SINK: 4063,
    /** `templewall_base` … `templewall_10`. */
    WALL_BASE: 4068,
    WALL_DONE: 4078,
    /** `templewallcorner_base` … `templewallcorner_10`. */
    CORNER_BASE: 4079,
    CORNER_DONE: 4089,
    ALTAR_LIT: 4090,
    ALTAR_UNLIT: 4091,
    ALTAR_BROKEN: 4092,
    PYRE_EMPTY: 4093,
    PYRE_LOGS: 4094,
    PYRE_BONES: 4100
} as const;

/** Every piece of the temple shell, at any repair level. */
export function isTempleWall(id: number): boolean {
    return (id >= SM_LOC_ID.WALL_BASE && id <= SM_LOC_ID.WALL_DONE)
        || (id >= SM_LOC_ID.CORNER_BASE && id <= SM_LOC_ID.CORNER_DONE);
}

export const SM_TILE = {
    /** Herbi Flax's house: the diary shelf, the herb table and two empty-vial spawns. */
    SHELF: new Tile(3481, 3279, 0),
    TABLE: new Tile(3482, 3278, 0),
    VIALS: new Tile(3481, 3278, 0),
    // Why: the sink stands on (3495,3288) and blocks it, so the anchor is the tile the walker can finish on.
    SINK: new Tile(3495, 3289, 0),
    DEAD_TREE: new Tile(3491, 3289, 0),
    RAZMIRE: new Tile(3489, 3296, 0),
    ULSQUIRE: new Tile(3496, 3289, 0),
    TOWN: new Tile(3490, 3290, 0),
    /** The one gap in the temple shell, on the south face. */
    TEMPLE_DOOR: new Tile(3506, 3314, 0),
    /** Inside the shell, one tile south of the altar. */
    TEMPLE_INSIDE: new Tile(3506, 3315, 0),
    ALTAR: new Tile(3506, 3316, 0),
    /** The pyre site closest to town and to the temple. */
    PYRE: new Tile(3506, 3274, 0),
    VARROCK_LOGS: new Tile(3243, 3396, 0),
    VARROCK_BANK: new Tile(3253, 3420, 0)
} as const;

export const VARROCK_GENERAL = { npc: 'Shop keeper', anchor: new Tile(3218, 3414, 0) };

// Why: both villagers answer to their afflicted name until a dose of serum 207 lands on them, and revert 200 ticks later, so every query has to accept either name.
export const SM_NPC = {
    RAZMIRE: 'Razmire Keelgan',
    RAZMIRE_AFFLICTED: 'Afflicted(Razmire)',
    ULSQUIRE: 'Ulsquire Shauncy',
    ULSQUIRE_AFFLICTED: 'Afflicted(Ulsquire)',
    SHADOW: 'Loar Shadow',
    SHADE: 'Loar Shade'
} as const;

export const SM_NPC_ID = {
    SHADOW: 1240,
    SHADE: 1241
} as const;

export const RAZMIRE_STOP: NpcStop = {
    npc: SM_NPC.RAZMIRE,
    anchor: SM_TILE.RAZMIRE,
    leash: 6,
    prefer: [
        'Yes, I have actually!',
        "Yes, I'll dispatch those dark and evil creatures.",
        'What are all these shadow creatures?',
        'Ok, thanks.'
    ]
};

export const ULSQUIRE_STOP: NpcStop = {
    npc: SM_NPC.ULSQUIRE,
    anchor: SM_TILE.ULSQUIRE,
    leash: 6,
    prefer: ['What can you tell me about that temple?', 'Ok thanks', 'Ok, thanks.']
};

interface Pos {
    x: number;
    z: number;
    level: number;
}

/** The Mort'ton map square — everything this quest does happens inside it. */
export function inMortton(t: Pos | null | undefined): boolean {
    return !!t && t.level === 0 && t.x >= 3456 && t.x <= 3519 && t.z >= 3264 && t.z <= 3327;
}

// Why: Razmire's ai_timer only recomputes the three flamtaer meters for players standing in this zone, so a reading taken outside it is whatever it was when the bot last left.

/** The `mortton_temple_zones` coord pair the overlay update tests. */
export function inTempleZone(t: Pos | null | undefined): boolean {
    return !!t && t.level === 0 && t.x >= 3492 && t.x <= 3518 && t.z >= 3308 && t.z <= 3323;
}
