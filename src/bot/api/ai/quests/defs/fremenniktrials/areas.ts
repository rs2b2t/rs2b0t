import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const FT_NAME = 'The Fremennik Trials';

/** Object ids. Red disk, Hunters' talisman, Enchanted lyre and Sealed vase each name more than one object. */
export const FT_ID = {
    UNSTRUNG_LYRE: 3688,
    LYRE: 3689,
    ENCHANTED_LYRE: 3690,
    BRANCH: 3692,
    GOLDEN_FLEECE: 3693,
    GOLDEN_WOOL: 3694,
    PET_ROCK: 3695,
    TALISMAN_CHARGED: 3696,
    TALISMAN: 3697,
    FLOWER: 3698,
    BALLAD: 3699,
    STURDY_BOOTS: 3700,
    HUNTERS_MAP: 3701,
    BOWSTRING: 3702,
    UNUSUAL_FISH: 3703,
    SEA_MAP: 3704,
    FORECAST: 3705,
    CHAMPIONS_TOKEN: 3706,
    COCKTAIL: 3707,
    FISCAL_STATEMENT: 3708,
    PROMISSORY_NOTE: 3709,
    WARRIORS_CONTRACT: 3710,
    BEER_KEG: 3711,
    LOW_ALCOHOL_KEG: 3712,
    FIRECRACKER: 3713,
    FIRECRACKER_LIT: 3714,
    BUCKET_5: 3722,
    BUCKET_4: 3723,
    BUCKET_3: 3724,
    BUCKET_2: 3725,
    BUCKET_1: 3726,
    BUCKET_EMPTY: 3727,
    JUG_3: 3729,
    JUG_2: 3730,
    JUG_1: 3731,
    JUG_EMPTY: 3732,
    VASE: 3734,
    VASE_WATER: 3735,
    VASE_LID: 3737,
    SEALED_VASE_WATER: 3740,
    FROZEN_KEY: 3741,
    RED_HERRING: 3742,
    RED_DISK: 3743,
    WOODEN_DISK: 3744,
    SEERS_KEY: 3745,
    RED_GOOP: 3746,
    RAW_SHARK: 383,
    KNIFE: 946,
    COINS: 995,
    POTATO: 1942,
    ONION: 1957,
    CABBAGE: 1965
} as const;

export const FT_LOC = {
    LAKE_ALTAR: 4141,
    MUSICAL_TREE: 4142,
    TROLL_CAULDRON: 4149,
    MAZE_PORTAL_1: 4150,
    MAZE_PORTAL_2: 4151,
    MAZE_PORTAL_3: 4152,
    MAZE_PORTAL_4: 4153,
    MAZE_PORTAL_5: 4154,
    MAZE_PORTAL_6: 4155,
    MAZE_PORTAL_7: 4156,
    MAZE_LADDER_TOP: 4158,
    MAZE_EXIT: 4160,
    BACKSTAGE_DOOR: 4148,
    PIPE: 4162,
    SEER_UP_LADDER: 4163,
    SEER_DOWN_LADDER: 4164,
    SEER_DOOR1: 4165,
    SEER_DOOR2: 4166,
    SEER_CHEST_SHUT: 4167,
    SEER_CHEST_OPEN: 4168,
    FROZEN_TABLE: 4169,
    SCALES_CHEST: 4170,
    BOOKCASE: 4171,
    RANGE: 4172,
    TRAPDOOR_OPEN: 4173,
    TRAPDOOR_SHUT: 4174,
    DRAIN: 4175,
    TAP: 4176,
    CUPBOARD_SHUT: 4177,
    CUPBOARD_OPEN: 4178,
    MURAL: 4179,
    UNICORN_HEAD: 4181,
    BULL_HEAD: 4182,
    WARRIOR_LADDER: 4187,
    WARRIOR_LADDER_DOWN: 4189
} as const;

export const FT_TILE = {
    /** Every bank leg in the quest; Rellekka has none until the quest is over. */
    SEERS_BANK: new Tile(2725, 3491, 0),

    LONGHALL: new Tile(2660, 3676, 0),
    /** The keg table by the bar. */
    KEG_TABLE: new Tile(2660, 3676, 0),
    /** East of the drain pipe, outside the longhall wall. */
    PIPE_STAND: new Tile(2664, 3674, 0),
    /** On the stage, past the bouncer's door. */
    STAGE: new Tile(2658, 3683, 0),
    /** The tile the backstage door is clicked from — its wall is the west edge of x 2667. */
    BACKSTAGE_DOOR: new Tile(2667, 3683, 0),
    BACKSTAGE_INNER: new Tile(2666, 3683, 0),

    ONION_PATCH: new Tile(2677, 3656, 0),
    POTATO_PATCH: new Tile(2677, 3654, 0),
    CABBAGE_PATCH: new Tile(2677, 3652, 0),
    KNIFE_SPAWN: new Tile(2681, 3717, 0),
    AXE_SPAWN: new Tile(2678, 3731, 0),

    MUSICAL_TREE: new Tile(2739, 3638, 0),
    TROLL_CAULDRON: new Tile(2772, 3624, 0),
    /** North of the shrine: the altar sits on the blocked tile at the end of a one-wide jetty. */
    LAKE_ALTAR: new Tile(2626, 3599, 0),
    /** Seers' Village, first floor — the Rellekka wheel refuses anyone who is not a Fremennik. */
    SPINNING_WHEEL: new Tile(2712, 3471, 1),

    COUNCIL_WORKMAN: new Tile(2655, 3593, 0),
    FORESTERS_ARMS: new Tile(2690, 3494, 0),
    POISON_SALESMAN: new Tile(2695, 3495, 0),
    ARHEIN: new Tile(2803, 3431, 0),
    RUFUS: new Tile(3507, 3497, 0),

    MAZE_LADDER: new Tile(2644, 3658, 0),
    MAZE_ENTRY: new Tile(2631, 10004, 0),
    MAZE_EXIT_STAND: new Tile(2665, 10038, 0),

    SEER_DOOR1: new Tile(2631, 3667, 0),
    SEER_DOOR1_INNER: new Tile(2631, 3666, 0),
    SEER_UP_LADDER: new Tile(2631, 3664, 0),
    SEER_DOWN_LADDER: new Tile(2635, 3663, 0),
    SEER_DOOR2_INNER: new Tile(2636, 3666, 0),
    MURAL_STAND: new Tile(2635, 3663, 0),

    /** Level 2 of the puzzle house. Both trapdoor tiles are blocked floor, so every stand is beside one. */
    PUZZLE_WEST_TRAPDOOR: new Tile(2631, 3664, 2),
    PUZZLE_EAST_TRAPDOOR: new Tile(2636, 3664, 2),
    PUZZLE_TAP: new Tile(2630, 3661, 2),
    PUZZLE_DRAIN: new Tile(2630, 3662, 2),
    PUZZLE_RANGE: new Tile(2630, 3663, 2),
    PUZZLE_CUPBOARD: new Tile(2629, 3661, 2),
    PUZZLE_UNICORN: new Tile(2632, 3661, 2),
    PUZZLE_BULL: new Tile(2634, 3661, 2),
    PUZZLE_CHEST: new Tile(2635, 3661, 2),
    PUZZLE_SCALES: new Tile(2632, 3664, 2),
    PUZZLE_BOOKCASE: new Tile(2634, 3664, 2),
    PUZZLE_FROZEN_TABLE: new Tile(2638, 3664, 2),

    WARRIOR_LADDER: new Tile(2666, 3694, 0),
    /** Where the honourable death drops you, one floor above Thorvald. */
    WARRIOR_LOFT: new Tile(2667, 3692, 1),
    WARRIOR_LOFT_LADDER: new Tile(2666, 3694, 1)
} as const;

/** The seven correct portals, in the order the maze wants them, with the tile each one lands you on. */
export const MAZE_ROUTE: readonly { id: number; stand: Tile; land: Tile }[] = [
    { id: FT_LOC.MAZE_PORTAL_1, stand: new Tile(2631, 10003, 0), land: new Tile(2642, 10017, 0) },
    { id: FT_LOC.MAZE_PORTAL_2, stand: new Tile(2640, 10015, 0), land: new Tile(2651, 10004, 0) },
    { id: FT_LOC.MAZE_PORTAL_3, stand: new Tile(2655, 10004, 0), land: new Tile(2667, 10015, 0) },
    { id: FT_LOC.MAZE_PORTAL_4, stand: new Tile(2665, 10017, 0), land: new Tile(2630, 10028, 0) },
    { id: FT_LOC.MAZE_PORTAL_5, stand: new Tile(2630, 10024, 0), land: new Tile(2653, 10035, 0) },
    { id: FT_LOC.MAZE_PORTAL_6, stand: new Tile(2656, 10036, 0), land: new Tile(2668, 10026, 0) },
    { id: FT_LOC.MAZE_PORTAL_7, stand: new Tile(2666, 10028, 0), land: new Tile(2665, 10038, 0) }
];

const stop = (npc: string, x: number, z: number, prefer: string[] = [], leash = 8): NpcStop =>
    ({ npc, anchor: new Tile(x, z, 0), leash, prefer });

export const BRUNDT = (prefer: string[]): NpcStop => stop('Brundt the Chieftain', 2659, 3669, prefer, 10);
export const MANNI = (prefer: string[]): NpcStop => stop('Manni the Reveller', 2660, 3673, prefer);
export const THORA = (prefer: string[]): NpcStop => stop('Thora the Barkeep', 2662, 3673, prefer);
export const OLAF = (prefer: string[]): NpcStop => stop('Olaf the Bard', 2673, 3683, prefer);
export const PEER = (prefer: string[]): NpcStop => stop('Peer the Seer', 2634, 3668, prefer);
export const SIGLI = (prefer: string[]): NpcStop => stop('Sigli the Huntsman', 2660, 3653, prefer);
export const SIGMUND = (prefer: string[]): NpcStop => stop('Sigmund The Merchant', 2641, 3680, prefer);
export const SWENSEN = (prefer: string[]): NpcStop => stop('Swensen the Navigator', 2646, 3660, prefer);
export const THORVALD = (prefer: string[]): NpcStop => stop('Thorvald the Warrior', 2666, 3693, prefer);
export const YRSA = (prefer: string[]): NpcStop => stop('Yrsa', 2625, 3675, prefer);
export const SKULGRIMEN = (prefer: string[]): NpcStop => stop('Skulgrimen', 2663, 3694, prefer);
export const FISHERMAN = (prefer: string[]): NpcStop => stop('Fisherman', 2641, 3699, prefer);
export const SAILOR = (prefer: string[]): NpcStop => stop('Sailor', 2629, 3693, prefer);
export const ASKELADDEN = (prefer: string[]): NpcStop => stop('Askeladden', 2658, 3660, prefer);
export const LALLI = (prefer: string[]): NpcStop => stop('Lalli', 2770, 3623, prefer);
export const COUNCIL_WORKMAN = (prefer: string[]): NpcStop => stop('Council workman', 2655, 3593, prefer);
export const POISON_SALESMAN = (prefer: string[]): NpcStop => stop('Poison salesman', 2695, 3495, prefer);

/** Every NPC that answers "Ask about the Merchant's trial" also opens with the vote conversation. */
export const MERCHANT_FIRST = ["Ask about the Merchant's trial"];

function within(t: WorldTile | null | undefined, x0: number, x1: number, z0: number, z1: number, level: number): boolean {
    return !!t && t.level === level && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
}

export function inMaze(t: WorldTile | null | undefined): boolean {
    return within(t, 2624, 2687, 9984, 10047, 0);
}

export function inBattleground(t: WorldTile | null | undefined): boolean {
    return within(t, 2624, 2687, 10048, 10111, 2);
}

/** The level-2 puzzle rooms, which only the two ladders reach. */
export function inPuzzleRoom(t: WorldTile | null | undefined): boolean {
    return within(t, 2628, 2639, 3659, 3666, 2);
}

// Why: both halves are sealed pockets in the collision pack, split by the wall at x 2634 that the mural hangs on — a flood from each door is what these boxes were measured from.

/** The half of the puzzle house behind door 1 — the way in, and the way to fail out. */
export function inSeerWest(t: WorldTile | null | undefined): boolean {
    return within(t, 2629, 2633, 3659, 3666, 0);
}

/** The half behind door 2, holding the mural and the locked exit. */
export function inSeerEast(t: WorldTile | null | undefined): boolean {
    return within(t, 2634, 2638, 3659, 3666, 0);
}

export function inLonghall(t: WorldTile | null | undefined): boolean {
    return within(t, 2655, 2662, 3665, 3681, 0);
}

export function onStage(t: WorldTile | null | undefined): boolean {
    return within(t, 2655, 2662, 3682, 3685, 0);
}

/** The doorway and the corridor behind it, where the crossing is already spent. */
export function pastBackstage(t: WorldTile | null | undefined): boolean {
    return within(t, 2663, 2667, 3682, 3685, 0);
}
