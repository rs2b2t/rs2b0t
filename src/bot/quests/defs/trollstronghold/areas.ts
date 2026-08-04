import Tile from '../../../api/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';
import type { NpcStop } from '../../exec/primitives.js';

/** Display / inventory names from content obj configs. */
export const ITEM = {
    CLIMBING_BOOTS: 'Climbing boots',
    PRISON_KEY: 'Prison key',
    CELL_KEY_1: 'Cell key 1',
    CELL_KEY_2: 'Cell key 2',
    COINS: 'Coins'
} as const;

export const FOOD_TARGET = 18;
export const COIN_FLOAT = 500;
export const BOOT_COST = 12;

/** Combat food the module will withdraw / sustain on. */
export const COMBAT_FOODS = [
    'Shark',
    'Swordfish',
    'Lobster',
    'Tuna',
    'Salmon',
    'Trout',
    'Cooked meat',
    'Bread'
] as const;

/** Falador West — nearest listed bank to Burthorpe. */
export const FALADOR_WEST_BANK = new Tile(2946, 3369, 0);

// --- surface anchors (Burthorpe / Death Plateau secret way / arena) ----------

export const DENULTH_TILE = new Tile(2896, 3528, 0);
export const DUNSTAN_TILE = new Tile(2919, 3574, 0);
/** Tenzing's hut (post–Death Plateau boot shop). */
export const TENZING_TILE = new Tile(2820, 3555, 0);
/** Death Plateau secret-path climbing rocks (boots required at z≈3611). */
export const DEATH_ROCKS = new Tile(2880, 3595, 0);
/** Dad spawn zone 0_45_56_32_29. */
export const DAD_ARENA = new Tile(2912, 3613, 0);
export const ARENA_ENTRANCE = new Tile(2907, 3607, 0);
/** Stronghold surface entrance (Enter → multi-level dungeon). */
export const STRONGHOLD_DOOR = new Tile(2840, 3690, 0);

// --- stronghold interior (z ≥ 10000 content plane) ---------------------------

/** Arrival after Stronghold Enter: 2_44_157_21_42. */
export const STRONGHOLD_TOP = new Tile(2837, 10090, 2);
/** Generals camp near top floor fire. */
export const GENERAL_CAMP = new Tile(2830, 10080, 2);
/** Prison level cells: Godric 0_44_157_11_29, Eadgar 0_44_157_11_33. */
export const PRISON_FLOOR = new Tile(2830, 10070, 0);
export const GODRIC_CELL = new Tile(2827, 10077, 0);
export const EADGAR_CELL = new Tile(2827, 10081, 0);
export const PRISON_DOOR_AREA = new Tile(2835, 10062, 0);

export type TrollArea =
    | 'burthorpe'
    | 'secretPath'
    | 'arena'
    | 'trollheim'
    | 'stronghold'
    | 'mainland'
    | 'unknown';

export function trollArea(tile: QuestSnapshot['tile']): TrollArea {
    if (!tile) {
        return 'unknown';
    }
    // Stronghold interior uses content map squares 44,157 / 45,156 (z ~10000+).
    if (tile.z >= 9900 && tile.z <= 10200 && tile.x >= 2800 && tile.x <= 2950) {
        return 'stronghold';
    }
    if (tile.level === 0 && tile.x >= 2895 && tile.x <= 2930 && tile.z >= 3600 && tile.z <= 3635) {
        return 'arena';
    }
    if (tile.level === 0 && tile.x >= 2800 && tile.x <= 2940 && tile.z >= 3575 && tile.z <= 3620) {
        return 'secretPath';
    }
    // Camp / mountain north of the arena after Dad.
    if (tile.level === 0 && tile.x >= 2810 && tile.x <= 2940 && tile.z > 3620 && tile.z < 3720) {
        return 'trollheim';
    }
    if (tile.level === 0 && tile.x >= 2880 && tile.x <= 2940 && tile.z >= 3480 && tile.z < 3580) {
        return 'burthorpe';
    }
    if (tile.level === 0 && tile.z < 5000) {
        return 'mainland';
    }
    return 'unknown';
}

export const DENULTH: NpcStop = {
    npc: 'Denulth',
    anchor: DENULTH_TILE,
    leash: 8,
    prefer: [
        'How goes your fight with the trolls?',
        'Is there anything I can do to help?',
        "I'll get Godric back!",
        'Do you have any quests for me?'
    ]
};

export const DUNSTAN: NpcStop = {
    npc: 'Dunstan',
    anchor: DUNSTAN_TILE,
    leash: 6,
    prefer: []
};

export const TENZING_BUY_BOOTS: NpcStop = {
    npc: 'Tenzing',
    anchor: TENZING_TILE,
    leash: 6,
    prefer: ['Can I buy some Climbing boots?', 'OK, sounds good.']
};
