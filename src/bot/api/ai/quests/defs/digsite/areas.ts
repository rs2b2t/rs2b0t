import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const DIG_NAME = 'Digsite Quest';

// Why: Student, Digsite workman, Panning tray, Mixed chemicals and Rock sample all name more than one thing, so nothing in this module is matched by display name alone.

export const DIG_ID = {
    COINS: 995,
    SPECIMEN_JAR: 669,
    SPECIMEN_BRUSH: 670,
    ROCK_SAMPLE_GREEN: 671,
    ROCK_SAMPLE_ORANGE: 672,
    ROCK_SAMPLE_PURPLE: 673,
    CRACKED_SAMPLE: 674,
    ROCK_PICK: 675,
    TROWEL: 676,
    TRAY_EMPTY: 677,
    TRAY_MUD: 679,
    NUGGETS: 680,
    TALISMAN: 681,
    PLAIN_LETTER: 682,
    STAMPED_LETTER: 683,
    CERT_1: 691,
    CERT_2: 692,
    CERT_3: 693,
    EXPERT_SCROLL: 696,
    STONE_TABLET: 699,
    POWDER: 700,
    AMMONIUM_NITRATE: 701,
    LIQUID: 702,
    NITROGLYCERIN: 703,
    GROUND_CHARCOAL: 704,
    PRE_CHARCOAL: 705,
    POST_CHARCOAL: 706,
    COMPOUND: 707,
    ARCENIA_ROOT: 708,
    CHEST_KEY: 709,
    VIAL: 229,
    PESTLE: 233,
    TINDERBOX: 590,
    CHARCOAL: 973,
    ROPE: 954,
    CHISEL: 1755,
    OPAL: 1609,
    UNCUT_OPAL: 1625,
    CUP_OF_TEA: 1978
} as const;

/** Display names, for the steps that buy or withdraw rather than click. */
export const DIG_ITEM = {
    COINS: 'Coins',
    TROWEL: 'Trowel',
    SPECIMEN_JAR: 'Specimen jar',
    SPECIMEN_BRUSH: 'Specimen brush',
    TRAY: 'Panning tray',
    ROPE: 'Rope',
    VIAL: 'Vial',
    PESTLE: 'Pestle and mortar',
    TINDERBOX: 'Tinderbox',
    CHISEL: 'Chisel',
    CHARCOAL: 'Charcoal',
    CUP_OF_TEA: 'Cup of tea',
    OPAL: 'Opal',
    UNCUT_OPAL: 'Uncut opal',
    ARCENIA_ROOT: 'Arcenia root',
    STONE_TABLET: 'Stone tablet',
    TALISMAN: 'Talisman of zaros',
    EXPERT_SCROLL: 'Invitation letter',
    CHEST_KEY: 'Chest key',
    PLAIN_LETTER: 'Unstamped letter',
    STAMPED_LETTER: 'Stamped letter'
} as const;

export const DIG_NPC = {
    WORKMAN: 613,
    CAVE_WORKMAN: 614,
    STUDENT_GREEN: 615,
    STUDENT_ORANGE: 616,
    STUDENT_PURPLE: 617,
    EXAMINER: 618,
    EXPERT: 619,
    PANNING_GUIDE: 620,
    CURATOR: 646
} as const;

export const DIG_LOC = {
    WINCH_MAIN: 2350,
    WINCH_PRIVATE: 2351,
    /** In the western (private) shaft; climbs out beside the main winch. */
    LADDER_WEST: 2352,
    /** In the eastern (main) shaft; climbs out beside the private winch. */
    LADDER_EAST: 2353,
    SAMPLE_SACKS: 2356,
    BUSH_SAMPLE: 2358,
    BARREL: 2359,
    CHEST_OPEN: 2360,
    CHEST_SHUT: 2361,
    BRICK: 2362,
    PANNING_POINT: 2363
} as const;

/** The three ground-decoration soil locs the dig zones are made of. */
export const DIG_SOIL_IDS: readonly number[] = [2376, 2377, 2378];

// Why: `area_digsite.rs2` picks the exam level from `inzone(...)` on the soil's own coordinate, so these boxes are copied from it rather than paced out.

/** The level 3 site west of the student camp, and the training site south of it. */
export const DIG_ZONE = {
    LEVEL3: { stand: new Tile(3353, 3408, 0), minX: 3350, maxX: 3357, minZ: 3404, maxZ: 3412 },
    TRAINING: { stand: new Tile(3354, 3397, 0), minX: 3352, maxX: 3357, minZ: 3396, maxZ: 3400 }
} as const;

/** Every stand here is walkable in the collision pack; the ones beside a blocked loc say which side. */
export const DIG_TILE = {
    VARROCK_BANK: new Tile(3253, 3420, 0),
    CURATOR: new Tile(3255, 3446, 0),
    TEA_SELLER: new Tile(3271, 3412, 0),
    GENERAL_STORE: new Tile(3218, 3414, 0),
    JATIX: new Tile(2899, 3427, 0),

    EXAMINER: new Tile(3360, 3343, 0),
    EXPERT: new Tile(3355, 3334, 0),

    PANNING_GUIDE: new Tile(3376, 3378, 0),
    /** West of the panning point at (3379,3377); the point itself is water. */
    PANNING_STAND: new Tile(3379, 3378, 0),
    /** North of the tray spawn at (3369,3378), which sits on a blocked tile. */
    TRAY_SPAWN_STAND: new Tile(3370, 3378, 0),
    TRAY_SPAWN: new Tile(3369, 3378, 0),
    /** East of the bush at (3357,3372). */
    BUSH_STAND: new Tile(3358, 3372, 0),
    /** North of the barrel at (3364,3378). */
    BARREL_STAND: new Tile(3364, 3377, 0),
    /** West of the chest at (3374,3378): `forceapproach=north` rotates with its angle-3 placement, so north is west in world space. */
    CHEST_STAND: new Tile(3373, 3378, 0),

    /** North of the sacks at (3359,3398). */
    SACKS_STAND: new Tile(3359, 3399, 0),
    /** The middle of the student camp, where all three colours spawn. */
    STUDENTS: new Tile(3358, 3410, 0),
    WORKMEN: new Tile(3357, 3407, 0),

    /** North of the main winch, whose 2x1 footprint covers (3352..3353,3417). */
    WINCH_MAIN_STAND: new Tile(3352, 3418, 0),
    /** South of the private winch, whose footprint covers (3370,3428..3429). */
    WINCH_PRIVATE_STAND: new Tile(3370, 3427, 0),

    /** Where the main winch drops you, in the eastern shaft. */
    SHAFT_EAST_LANDING: new Tile(3370, 9828, 0),
    /** Where the private winch drops you, in the western shaft. */
    SHAFT_WEST_LANDING: new Tile(3353, 9818, 0),
    CAVE_WORKMAN: new Tile(3352, 9822, 0),
    ARCENIA_WEST: new Tile(3351, 9824, 0),
    ARCENIA_WEST_ALT: new Tile(3348, 9819, 0),
    /** North of the blast bricks; `digsite_blockage_run_sequence` refuses any other tile. */
    BRICK_STAND: new Tile(3379, 9826, 0),
    /** Where the explosion leaves you, in the altar cave. */
    ALTAR_LANDING: new Tile(3368, 9767, 0),
    TABLET: new Tile(3374, 9747, 0),
    /** The eastern shaft's rope out, after the blast. */
    ALTAR_LADDER: new Tile(3370, 9764, 0)
} as const;

export const EXAMINER: NpcStop = {
    npc: 'Examiner',
    anchor: DIG_TILE.EXAMINER,
    leash: 8,
    prefer: []
};

export const EXPERT: NpcStop = {
    npc: 'Archaeological expert',
    anchor: DIG_TILE.EXPERT,
    leash: 6,
    prefer: []
};

export const CURATOR: NpcStop = {
    npc: 'Curator',
    anchor: DIG_TILE.CURATOR,
    leash: 6,
    prefer: []
};

export const PANNING_GUIDE: NpcStop = {
    npc: 'Panning guide',
    anchor: DIG_TILE.PANNING_GUIDE,
    leash: 6,
    prefer: []
};

function within(t: WorldTile | null | undefined, x0: number, x1: number, z0: number, z1: number): boolean {
    return !!t && t.level === 0 && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
}

// Why: a flood over the collision pack puts the four shaft pockets at 189, 52, 426 and 52 tiles with nothing walking between them, so these boxes are exact rather than generous.

/** The eastern shaft, before the blast: the blast bricks are here and nothing else is. */
export function inShaftEast(t: WorldTile | null | undefined): boolean {
    return within(t, 3360, 3392, 9820, 9856);
}

/** The western shaft: the cave workman with the chest key, and two arcenia roots. */
export function inShaftWest(t: WorldTile | null | undefined): boolean {
    return within(t, 3344, 3360, 9810, 9828);
}

/** The eastern shaft after the blast, which is a different mapsquare and holds the altar. */
export function inAltarCave(t: WorldTile | null | undefined): boolean {
    return within(t, 3360, 3392, 9736, 9792);
}

/** Any of the dig shafts, above or below the blast. */
export function inDigCave(t: WorldTile | null | undefined): boolean {
    return within(t, 3344, 3392, 9736, 9856);
}
