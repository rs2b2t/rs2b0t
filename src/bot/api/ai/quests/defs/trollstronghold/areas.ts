import Tile from '../../../../../geometry/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';
import type { NpcStop } from '../../exec/primitives.js';

/** Display names from the content obj configs. */
export const ITEM = {
    CLIMBING_BOOTS: 'Climbing boots',
    PRISON_KEY: 'Prison key',
    CELL_KEY_1: 'Cell key 1',
    CELL_KEY_2: 'Cell key 2',
    COINS: 'Coins'
} as const;

export const BOOT_COST = 12;
/** Enough for the boots several times over, and nothing worth a second bank trip. */
export const COIN_FLOAT = 500;
export const FOOD_TARGET = 16;
/** Below this the loadout is spent and the module walks back down for more. */
export const FOOD_FLOOR = 4;

/** Best dose first. */
export const PRAYER_POTIONS = [
    'Prayer potion(4)',
    'Prayer potion(3)',
    'Prayer potion(2)',
    'Prayer potion(1)'
] as const;

export const PRAYER_POTION_TARGET = 2;

export const PRAYER_SIP_AT = 0.5;

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

/** Falador West — Burthorpe has no bank on this content. */
export const FALADOR_WEST_BANK = new Tile(2946, 3369, 0);

export const TILE = {
    DENULTH: new Tile(2896, 3528, 0),
    DUNSTAN: new Tile(2919, 3574, 0),
    TENZING: new Tile(2820, 3556, 0),
    /** troll_champion map spawn; he is re-added at (2912,3613) when missing. */
    DAD: new Tile(2911, 3612, 0),
    /** Arena Entrance stand, west side of the door pair. */
    ARENA_GATE: new Tile(2896, 3618, 0),
    /** troll_general map spawn on the stronghold top floor. */
    GENERAL: new Tile(2831, 10086, 2),
    /** Stronghold arrival from the surface door. */
    STRONGHOLD_TOP: new Tile(2837, 10090, 2),
    /** West of the Prison Door, on the locked side's approach. */
    PRISON_DOOR: new Tile(2847, 10107, 1),
    /** Prison-floor landing from the lower staircase. */
    PRISON_LANDING: new Tile(2852, 10105, 0),
    /** Stand outside Godric's cell door (2832,10078). */
    GODRIC_CELL: new Tile(2833, 10078, 0),
    /** Stand outside Mad Eadgar's cell door (2832,10082). */
    EADGAR_CELL: new Tile(2833, 10082, 0)
} as const;

// Why: everything past the stile is committed ground, and re-provisioning from up there means climbing back down the secret way.

/** Where the character is, in the terms `decide()` cares about: whether a bank trip is still cheap. */
export type TrollZone = 'stronghold' | 'trollPass' | 'mountain' | 'arena' | 'secretWay' | 'mainland' | 'unknown';

export function trollZone(tile: QuestSnapshot['tile']): TrollZone {
    if (!tile) {
        return 'unknown';
    }
    const { x, z, level } = tile;
    // Stronghold interior: mapsquare 44,157 across all three levels.
    if (x >= 2816 && x <= 2879 && z >= 10048 && z <= 10111) {
        return 'stronghold';
    }
    // The troll pass cave between the arena and the northern mountain.
    if (x >= 2880 && x <= 2943 && z >= 9984 && z <= 10047) {
        return 'trollPass';
    }
    if (level !== 0) {
        return 'unknown';
    }
    if (x >= 2879 && x <= 2925 && z >= 3596 && z <= 3648) {
        return 'arena';
    }
    if (x >= 2828 && x <= 2920 && z >= 3649 && z <= 3711) {
        return 'mountain';
    }
    // Everything above the stile on the secret way, plus the north-west pocket
    // the prison's back door opens onto.
    if (x >= 2812 && x <= 2882 && z >= 3563 && z <= 3648) {
        return 'secretWay';
    }
    return 'mainland';
}

/** True once the character is past the stile: no more cheap bank trips. */
export function committed(zone: TrollZone): boolean {
    return zone !== 'mainland' && zone !== 'unknown';
}

export const DENULTH_START: NpcStop = {
    npc: 'Denulth',
    anchor: TILE.DENULTH,
    leash: 8,
    prefer: [
        'How goes your fight with the trolls?',
        'Is there anything I can do to help?',
        "I'll get Godric back!"
    ]
};

export const DUNSTAN_FINISH: NpcStop = {
    npc: 'Dunstan',
    anchor: TILE.DUNSTAN,
    leash: 8,
    prefer: ['Nothing, thanks.']
};

// Why: Tenzing's post-quest shop is a dialogue rather than a shop interface, and it loops — after every purchase he asks "Was there anything else?" and re-offers the same five options.
// Why: a plain preference list matches "Can I buy some Climbing boots?" again and buys until the pack is full, so the exit is driven off what he said rather than off the options.
export const TENZING_BOOTS: NpcStop = {
    npc: 'Tenzing',
    anchor: TILE.TENZING,
    leash: 6,
    prefer: ['Can I buy some Climbing boots?', 'OK, sounds good.', 'Nothing, thanks!']
};

export const TENZING_DONE_RULES = [
    { whenLine: 'was there anything else', choose: 'Nothing, thanks!' }
] as const;
