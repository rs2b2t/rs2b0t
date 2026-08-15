import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface WatchtowerItem {
    id: number;
    name: string;
}

// Why: these are the engine's names, and several collide — all four crystals are "Crystal", both mid-brew vials are "Vial", and the ogre potion is "Potion".
// Why: every lookup in this quest therefore goes through the id.
export const WT_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    ROPE: { id: 954, name: 'Rope' },
    LIT_CANDLE: { id: 33, name: 'Lit candle' },
    VIAL_WATER: { id: 227, name: 'Vial of water' },
    JANGERBERRIES: { id: 247, name: 'Jangerberries' },
    GUAM_LEAF: { id: 249, name: 'Guam leaf' },
    GUAM_VIAL: { id: 91, name: 'Unfinished potion' },
    PESTLE: { id: 233, name: 'Pestle and mortar' },
    PICKAXE: { id: 1265, name: 'Bronze pickaxe' },
    BAT_BONES: { id: 530, name: 'Bat bones' },
    DRAGON_BONES: { id: 536, name: 'Dragon bones' },
    DEATH_RUNE: { id: 560, name: 'Death rune' },
    GOLD_BAR: { id: 2357, name: 'Gold bar' },
    OGRE_RELIC: { id: 2372, name: 'Ogre relic' },
    RELIC_PART1: { id: 2373, name: 'Relic part 1' },
    RELIC_PART2: { id: 2374, name: 'Relic part 2' },
    RELIC_PART3: { id: 2375, name: 'Relic part 3' },
    SKAVID_MAP: { id: 2376, name: 'Skavid map' },
    OGRE_TOOTH: { id: 2377, name: 'Ogre tooth' },
    TOBAN_KEY: { id: 2378, name: 'Toban key' },
    ROCK_CAKE: { id: 2379, name: 'Rock cake' },
    CRYSTAL1: { id: 2380, name: 'Crystal' },
    CRYSTAL2: { id: 2381, name: 'Crystal' },
    CRYSTAL3: { id: 2382, name: 'Crystal' },
    CRYSTAL4: { id: 2383, name: 'Crystal' },
    FINGERNAILS: { id: 2384, name: 'Finger nails' },
    JANGER_VIAL: { id: 2389, name: 'Vial' },
    GUAM_JANGER_VIAL: { id: 2390, name: 'Vial' },
    GROUND_BAT_BONES: { id: 2391, name: 'Ground bat bones' },
    STOLEN_GOLD: { id: 2393, name: 'Gold' },
    OGRE_POTION: { id: 2394, name: 'Potion' },
    MAGIC_OGRE_POTION: { id: 2395, name: 'Magic ogre potion' },
    WATCHTOWER_SPELL: { id: 2396, name: 'Spell scroll' },
    SHAMAN_ROBE: { id: 2397, name: 'Shaman robe' },
    NIGHTSHADE: { id: 2398, name: 'Nightshade' }
} as const satisfies Record<string, WatchtowerItem>;

export const CRYSTALS = [WT_ITEM.CRYSTAL1, WT_ITEM.CRYSTAL2, WT_ITEM.CRYSTAL3, WT_ITEM.CRYSTAL4] as const;
export const RELIC_PARTS = [WT_ITEM.RELIC_PART1, WT_ITEM.RELIC_PART2, WT_ITEM.RELIC_PART3] as const;

export const WT_LOC = {
    WALL_CLIMB: 2299,
    LADDER_TOP: 1746,
    WATCH_LADDER_UP: 2796,
    WATCH_LADDER_DOWN: 2797,
    TOWER_LADDER: 2833,
    LEVER: 2794,
    BUSH_NAIL: 2799,
    ROPESWING: 2324,
    ROPESWING_NOROPE: 2326,
    TOBAN_CHEST: 2790,
    TOBAN_CAVE: 2811,
    TOBAN_LADDER_DOWN: 2812,
    GATE_RELIC: 2788,
    GATE_EAST: 2786,
    ROCK_CAKE_STALL: 2793,
    BATTLEMENT: 2832,
    JUMP_IN: 2830,
    JUMP_OUT: 2831,
    ENCLAVE_CAVE: 2813,
    DARK_CAVE_ESCAPE: 2825,
    ROCK_OF_DALGROTH: 2816,
    CAVE_IN: [2805, 2806, 2807, 2808, 2809, 2810] as readonly number[],
    CAVE_OUT: [2817, 2818, 2819, 2820, 2821, 2822] as readonly number[]
} as const;

export const WT_NPC = {
    WIZARD: 'Watchtower wizard',
    OG: 'Og',
    GREW: 'Grew',
    TOBAN: 'Toban',
    GORAD: 'Gorad',
    CITY_GUARD: 'City guard',
    OGRE_GUARD: 'Ogre guard',
    ENCLAVE_GUARD: 'Enclave guard',
    SHAMAN: 'Ogre shaman',
    // Only the four language talkers are plain 'Skavid'.
    SKAVID: 'Skavid',
    SCARED_SKAVID: 'Scared skavid',
    MAD_SKAVID: 'Mad skavid'
} as const;

export const WT_TILE = {
    YANILLE_BANK: new Tile(2612, 3092, 0),
    WALL_CLIMB_STAND: new Tile(2548, 3120, 0),
    TOWER_LADDER_STAND: new Tile(2544, 3112, 0),
    LADDER_UP_STAND: new Tile(2549, 3112, 1),
    WIZARD_FLOOR: new Tile(2549, 3112, 2),
    LEVER_STAND: new Tile(2543, 3116, 2),
    BUSH_NAIL: new Tile(2544, 3134, 0),
    CANDLE: new Tile(2547, 3115, 0),
    OG: new Tile(2506, 3116, 0),
    ROPESWING_STAND: new Tile(2501, 3087, 0),
    GREW: new Tile(2513, 3084, 0),
    GREW_EXIT_STAND: new Tile(2511, 3091, 0),
    JANGERBERRIES: [
        new Tile(2510, 3090, 0),
        new Tile(2512, 3080, 0),
        new Tile(2516, 3086, 0),
        new Tile(2517, 3082, 0)
    ],
    TOBAN_CAVE: new Tile(2499, 2988, 0),
    TOBAN_LADDER: new Tile(2575, 3028, 0),
    TOBAN_CHEST: new Tile(2575, 3032, 0),
    TOBAN: new Tile(2576, 3027, 0),
    GORAD: new Tile(2577, 3021, 0),
    GATE_RELIC_STAND: new Tile(2506, 3062, 0),
    HILL: new Tile(2546, 3065, 0),
    // North of the counter: the steal is refused while ogre_trader2 (spawns
    // 2506,3020) is within 3 tiles, and every tile beside it at z=3023 is 3.
    ROCK_CAKE_STALL: new Tile(2506, 3024, 0),
    EAST_GATE_STAND: new Tile(2550, 3030, 0),
    EAST_GATE_INSIDE: new Tile(2549, 3027, 0),
    BATTLEMENT_GUARD: new Tile(2503, 3011, 0),
    BATTLEMENT_INSIDE: new Tile(2508, 3011, 0),
    JUMP_STAND: new Tile(2531, 3026, 0),
    JUMP_BACK_STAND: new Tile(2530, 3029, 0),
    CITY_GUARD: new Tile(2541, 3029, 0),
    ENCLAVE_GUARD: new Tile(2507, 3037, 0),
    ENCLAVE_EXIT: new Tile(2598, 9467, 0),
    ROCK_OF_DALGROTH: new Tile(2590, 9450, 0),
    SHAMAN_ROBE: new Tile(2617, 9437, 0),
    SHAMANS: [
        new Tile(2577, 9451, 0),
        new Tile(2582, 9437, 0),
        new Tile(2592, 9436, 0),
        new Tile(2599, 9461, 0),
        new Tile(2606, 9438, 0),
        new Tile(2607, 9451, 0)
    ]
} as const;

interface SkavidCave {
    index: number;
    // Why: the mouth loc is a 4x2 blocker, and for cave 1 the only reachable side is the south.

    /** A walkable tile the mouth can be clicked from. */
    stand: Tile;
    landing: Tile;
}

export const WT_CAVES: readonly SkavidCave[] = [
    { index: 1, stand: new Tile(2561, 3021, 0), landing: new Tile(2498, 9418, 0) },
    { index: 2, stand: new Tile(2522, 3070, 0), landing: new Tile(2532, 9469, 0) },
    { index: 3, stand: new Tile(2539, 3054, 0), landing: new Tile(2518, 9455, 0) },
    { index: 4, stand: new Tile(2552, 3054, 0), landing: new Tile(2498, 9451, 0) },
    { index: 5, stand: new Tile(2552, 3034, 0), landing: new Tile(2504, 9441, 0) },
    { index: 6, stand: new Tile(2529, 3013, 0), landing: new Tile(2522, 9411, 0) }
];

export const WT_NIGHTSHADE = {
    cave2: new Tile(2530, 9462, 0),
    cave6: new Tile(2528, 9415, 0)
} as const;

export type WatchtowerArea =
    | 'yanille'
    | 'towerFloor'
    | 'grewIsland'
    | 'tobanCamp'
    | 'lowerCity'
    | 'cityGuard'
    | 'skavidCaves'
    | 'enclave'
    | 'mirrorTower'
    | 'unknown';

export function watchtowerArea(tile: QuestSnapshot['tile']): WatchtowerArea {
    if (!tile) return 'unknown';
    const { x, z, level } = tile;
    if (x >= 2900 && x <= 2960 && z >= 4670 && z <= 4740) return 'mirrorTower';
    if (z >= 9400 && z <= 9480 && x >= 2490 && x <= 2540) return 'skavidCaves';
    if (z >= 9400 && z <= 9480 && x >= 2560 && x <= 2623) return 'enclave';
    if (level === 2 && x >= 2540 && x <= 2552 && z >= 3108 && z <= 3120) return 'towerFloor';
    if (x >= 2505 && x <= 2519 && z >= 3079 && z <= 3092) return 'grewIsland';
    if (x >= 2565 && x <= 2585 && z >= 3015 && z <= 3040) return 'tobanCamp';
    if (x >= 2527 && x <= 2545 && z >= 3027 && z <= 3036) return 'cityGuard';
    if (x >= 2508 && x <= 2532 && z >= 3005 && z <= 3026) return 'lowerCity';
    return 'yanille';
}
