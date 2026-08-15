import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const PT_QUEST = "Pirate's Treasure";

/** `%hunt`, from quest_hunt.constant and general/configs/quest.constant. */
export const PT_STAGE = {
    NOT_STARTED: 0,
    FETCH_RUM: 1,
    RECEIVED_KEY: 2,
    READ_NOTE: 3,
    COMPLETE: 4
} as const;

export const PT_ID = {
    /** Displays as "Karamjan rum", the name both Tai Bwo Wannai bananas carry. */
    RUM: 431,
    /** Displays as "Chest key", the name the Digsite key carries. */
    CHEST_KEY: 432,
    PIRATE_MESSAGE: 433,
    SPADE: 952,
    COINS: 995,
    WHITE_APRON: 1005,
    GARDENER: 1217,
    BANANA: 1963
} as const;

export const PT_NAME = {
    RUM: 'Karamjan rum',
    CHEST_KEY: 'Chest key',
    PIRATE_MESSAGE: 'Pirate message',
    SPADE: 'Spade',
    COINS: 'Coins',
    WHITE_APRON: 'White apron',
    GARDENER: 'Gardener',
    BANANA: 'Banana'
} as const;

// Why: ordinary `crate` and `crate3` also render "Crate" with op1=Search, and four of them stand within six tiles of Wydin's grocery crate — the nearest is rarely the one the quest means.
export const PT_LOC = {
    GROCERY_CRATE: 2071,
    BANANA_CRATE: 2072,
    PIRATE_CHEST: 2079
} as const;

// Why: a tree keeps the name "Banana Tree" and its Search op through every stage down to empty, so matching by name re-picks a bare tree forever — 2078 is the empty one and the five that still bear fruit are the only valid targets.
export const BANANA_TREE_IDS: readonly number[] = [2073, 2074, 2075, 2076, 2077];

export const PT_TILE = {
    DRAYNOR_BANK: new Tile(3093, 3243, 0),
    FRANK: new Tile(3053, 3250, 0),
    BANANA_CRATE: new Tile(2943, 3151, 0),
    /** East end of the plantation grove; the trees run west and north from here. */
    BANANA_GROVE: new Tile(2926, 3160, 0),
    WYDIN: new Tile(3014, 3204, 0),
    GROCERY_CRATE: new Tile(3009, 3207, 0),
    THESSALIA: new Tile(3204, 3417, 0),
    PIRATE_CHEST: new Tile(3218, 3396, 1),
    SPADE_SPAWN: new Tile(2981, 3369, 0),
    DIG_SITE: new Tile(2999, 3383, 0)
} as const;

// Why: `redbeard_arr` jumps back to its own option list, so "Arr!" never ends the conversation and the trade line is the only safe way to close it.
export const FRANK: NpcStop = {
    npc: 'Redbeard Frank',
    anchor: PT_TILE.FRANK,
    leash: 6,
    prefer: [
        "I'm in search of treasure.",
        "Ok thanks, I'll go and get it.",
        'Do you have anything for trade?'
    ]
};

// Why: "Will you pay me for another crate full?" re-employs at the plantation, which the quest never needs twice, so the thanks line is preferred ahead of it.
export const LUTHAS: NpcStop = {
    npc: 'Luthas',
    anchor: new Tile(2939, 3154, 0),
    leash: 6,
    prefer: [
        'Could you offer me employment on your plantation?',
        "Thank you, I'll be on my way",
        "No, the crate isn't full yet."
    ]
};

export const WYDIN: NpcStop = {
    npc: 'Wydin',
    anchor: PT_TILE.WYDIN,
    leash: 6,
    prefer: ['Can I get a job here?', "No, it's a complete mess"]
};

export const THESSALIA_SHOP = { npc: 'Thessalia', anchor: PT_TILE.THESSALIA };
export const ZAMBO_SHOP = { npc: 'Zambo', anchor: new Tile(2925, 3143, 0) };
