import Tile from '../../../../../geometry/Tile.js';
import type { LadderHop, NpcStop } from '../../exec/primitives.js';

/** `%grandtree` values (quest_grandtree.constant, plus `^grandtree_complete` from quest.constant). */
export const GT_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    SPOKEN_HAZELMERE: 20,
    RELAYED_MESSAGE: 30,
    SPOKEN_GLOUGH: 40,
    FOUND_PRISONER: 50,
    SPOKEN_PRISONER: 60,
    FOUND_JOURNAL: 70,
    RELEASED_PRISON: 80,
    OBTAINED_LUMBER_ORDER: 90,
    CLUE_CHARLIE: 100,
    FOUND_INVASION_PLANS: 110,
    GIVEN_TWIGS: 120,
    UNLOCKED_TRAPDOOR: 130,
    DEFEATED_BLACK_DEMON: 140,
    SEARCHING_DACONIA: 150,
    COMPLETE: 160
} as const;

// Why: the four twigs all render "Twigs" and only the id says which pillar each belongs on, so every pack read here is by id.

/** `quest_grandtree.obj` ids. */
export const GT_OBJ = {
    BARK: 783,
    TRANSLATION_BOOK: 784,
    JOURNAL: 785,
    SCROLL: 786,
    LUMBER_ORDER: 787,
    KEY: 788,
    TWIG_T: 789,
    TWIG_U: 790,
    TWIG_Z: 791,
    TWIG_O: 792,
    DACONIA: 793,
    INVASION_PLANS: 794
} as const;

/** `quest_grandtree.loc` ids, plus the two root types. */
export const GT_LOC = {
    CUPBOARD_SHUT: 2434,
    CUPBOARD_OPEN: 2435,
    CHEST_SHUT: 2436,
    PILLAR_T: 2440,
    PILLAR_U: 2441,
    PILLAR_Z: 2442,
    PILLAR_O: 2443,
    TRAPDOOR_SHUT: 2444,
    CLIMB_TREE: 2447,
    DOWN_TREE: 2448,
    ROOT_A: 1985,
    ROOT_B: 1986
} as const;

export const GT_NPC = { BLACK_DEMON: 677 } as const;

/** Everything the quest carries; the keep-list a spillover deposit must not bank. */
export const GT_ITEMS = [
    'bark sample',
    'translation book',
    "hazelmere's scroll",
    'lumber order',
    "glough's journal",
    "glough's key",
    'twigs',
    'invasion plans',
    'daconia rock'
] as const;

export const GT_TILE = {
    /** King Narnode's map spawn, inside the trunk on the ground floor. */
    narnode: new Tile(2466, 3497, 0),
    /** The second King Narnode spawn, in the root caves under the tree. */
    narnodeUnder: new Tile(2464, 9896, 0),
    hazelmere: new Tile(2678, 3086, 1),
    /** Glough's first floor; his ladder is baked at (2476,3464). */
    glough: new Tile(2478, 3463, 1),
    gloughHouseFoot: new Tile(2476, 3464, 0),
    /** South of the cupboard: `forceapproach=east` rotates with its angle-1 placement. */
    cupboardStand: new Tile(2477, 3464, 1),
    /** North of the chest, the side `forceapproach=north` leaves legal at angle 0. */
    chestStand: new Tile(2482, 3463, 1),
    /** East of the tree that climbs to Glough's top floor; the loc's own tile is blocked. */
    climbTreeStand: new Tile(2484, 3463, 1),
    /** North of the tree back down off the pillar floor. */
    downTreeStand: new Tile(2485, 3465, 2),
    /** Where `~agility_climb_up` lands, on the pillar floor. */
    pillarFloor: new Tile(2486, 3465, 2),
    /** The trapdoor is ground decor and blocks its own tile, so this is the tile north of it. */
    trapdoorStand: new Tile(2487, 3465, 2),
    /** Where Glough's trapdoor drops the player, in the root caves. */
    caveLanding: new Tile(2491, 9864, 0),
    /** Beside the cave ladder back up to the trunk. */
    caveLadder: new Tile(2463, 9896, 0),
    charlie: new Tile(2465, 3495, 3),
    /** The cell tile the King's guards teleport the player into. */
    jail: new Tile(2464, 3496, 3),
    gliderPad: new Tile(2465, 3501, 3),
    /** Where the pilot crash-lands the glider in the Karamja jungle. */
    karamjaCrash: new Tile(2917, 3058, 0),
    foreman: new Tile(2999, 3043, 0),
    femi: new Tile(2460, 3382, 0),
    /** Where Femi's cart drops the player, inside the stronghold. */
    femiLanding: new Tile(2459, 3409, 0),
    anitaStairs: new Tile(2388, 3512, 0),
    anitaFloor: new Tile(2388, 3513, 1),
    anita: new Tile(2390, 3514, 1)
} as const;

/** Twig id → the pillar it belongs on, in the order `_grandtree_pillar` checks them. */
export const GT_PILLARS = [
    { obj: GT_OBJ.TWIG_T, loc: GT_LOC.PILLAR_T, stand: new Tile(2485, 3466, 2) },
    { obj: GT_OBJ.TWIG_U, loc: GT_LOC.PILLAR_U, stand: new Tile(2486, 3466, 2) },
    { obj: GT_OBJ.TWIG_Z, loc: GT_LOC.PILLAR_Z, stand: new Tile(2487, 3466, 2) },
    { obj: GT_OBJ.TWIG_O, loc: GT_LOC.PILLAR_O, stand: new Tile(2488, 3466, 2) }
] as const;

// Why: `%daconia_rock_root` is `random_range(1,15)` and the client cannot read it, so the rock is found by searching every root.
// Why: each root is a 3x3 that blocks its own footprint, and the stands below are the nearest walkable tile in the caves' own component.

/** The fifteen roots of `daconia_coords`, with a stand each. */
export const GT_ROOTS: readonly { sw: Tile; stand: Tile }[] = [
    { sw: new Tile(2456, 9886, 0), stand: new Tile(2455, 9885, 0) },
    { sw: new Tile(2457, 9881, 0), stand: new Tile(2456, 9882, 0) },
    { sw: new Tile(2455, 9874, 0), stand: new Tile(2454, 9875, 0) },
    { sw: new Tile(2443, 9878, 0), stand: new Tile(2442, 9877, 0) },
    { sw: new Tile(2439, 9881, 0), stand: new Tile(2438, 9881, 0) },
    { sw: new Tile(2444, 9893, 0), stand: new Tile(2443, 9892, 0) },
    { sw: new Tile(2452, 9893, 0), stand: new Tile(2451, 9892, 0) },
    { sw: new Tile(2465, 9891, 0), stand: new Tile(2464, 9890, 0) },
    { sw: new Tile(2468, 9890, 0), stand: new Tile(2467, 9889, 0) },
    { sw: new Tile(2467, 9896, 0), stand: new Tile(2466, 9895, 0) },
    { sw: new Tile(2473, 9897, 0), stand: new Tile(2472, 9896, 0) },
    { sw: new Tile(2481, 9904, 0), stand: new Tile(2480, 9903, 0) },
    { sw: new Tile(2485, 9885, 0), stand: new Tile(2484, 9884, 0) },
    { sw: new Tile(2490, 9889, 0), stand: new Tile(2489, 9888, 0) },
    { sw: new Tile(2467, 9872, 0), stand: new Tile(2466, 9871, 0) }
];

// Why: the second and third answers are the two the King only accepts in one order, so a preference list with them ahead of "None of the above." picks correctly on every page.
// Why: the first two pages offer none of them and fall through to "None of the above.", which is what `narnode_correct_b2` and `_b3` want.

/** Hazelmere's message, translated: the five answers `narnode_correct_*` accept. */
export const NARNODE_TRANSLATION = [
    'I think so!',
    'A man came to me with the King\'s seal.',
    'I gave the man Daconia rocks.',
    'And Daconia rocks will kill the tree!',
    'None of the above.'
];

export const NARNODE: NpcStop = {
    npc: 'King Narnode Shareen',
    anchor: GT_TILE.narnode,
    leash: 6,
    prefer: ['You seem worried, what\'s up?', 'I\'d be happy to help!', ...NARNODE_TRANSLATION]
};

export const NARNODE_UNDER: NpcStop = {
    npc: 'King Narnode Shareen',
    anchor: GT_TILE.narnodeUnder,
    leash: 8,
    prefer: []
};

export const HAZELMERE: NpcStop = {
    npc: 'Hazelmere',
    anchor: GT_TILE.hazelmere,
    leash: 8,
    prefer: []
};

export const GLOUGH: NpcStop = {
    npc: 'Glough',
    anchor: GT_TILE.glough,
    leash: 8,
    prefer: []
};

export const CHARLIE: NpcStop = {
    npc: 'Charlie',
    anchor: GT_TILE.charlie,
    leash: 4,
    prefer: []
};

export const ANITA: NpcStop = {
    npc: 'Anita',
    anchor: GT_TILE.anita,
    leash: 5,
    prefer: []
};

// Why: a wrong answer makes the foreman attack, so the list names the three `grandtree_foreman_rightans*` lines and nothing else.
export const FOREMAN: NpcStop = {
    npc: 'Foreman',
    anchor: GT_TILE.foreman,
    leash: 10,
    prefer: ['Sadly his wife is no longer with us!', 'He loves worm holes.', 'Anita.']
};

// Why: `%femi_help` is 0 until the gate's box-lifting conversation sets it, and both 0 and 2 ride free — only the 1 branch charges, which is what the pay option answers.
export const FEMI: NpcStop = {
    npc: 'Femi',
    anchor: GT_TILE.femi,
    leash: 6,
    prefer: ['OK then, I\'ll pay.', 'I\'d better get going!']
};

export const PILOT: NpcStop = {
    npc: 'Gnome pilot',
    anchor: GT_TILE.gliderPad,
    leash: 6,
    prefer: ['Take me to Karamja please!']
};

// Why: `grandtree_trapdoorunder` only opens once the quest is complete, so the caves have one ungated mouth and no other and it is one-way — the way in is Glough's trapdoor, which the module drives itself.
export const GT_HOPS: LadderHop[] = [
    { stand: GT_TILE.caveLadder, locName: 'Ladder', op: 'Climb-up', arrive: new Tile(2463, 3497, 0) }
];

export function inCaves(t: { z: number } | null | undefined): boolean {
    return t !== null && t !== undefined && t.z >= 9856 && t.z <= 9919;
}

/** True in the Karamja jungle and the shipyard, on the far side of the glider ride. */
export function inKaramja(t: { x: number; z: number } | null | undefined): boolean {
    return t !== null && t !== undefined && t.x >= 2850 && t.z <= 3200;
}

/** True inside the stronghold walls, which the gate shuts against a spy at stage 90. */
export function inStronghold(t: { x: number; z: number } | null | undefined): boolean {
    return t !== null && t !== undefined && t.x >= 2370 && t.x <= 2540 && t.z >= 3384 && t.z <= 3540;
}
