import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const KS_QUEST = "The Knight's Sword";

/** Exact `%squire` values from quest_squire.constant. */
export const KS_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_RELDO: 2,
    GIVEN_PIE: 3,
    SPOKEN_THURGO: 4,
    LOOKING_PORTRAIT: 5,
    LOOKING_BLURITE: 6,
    COMPLETE: 7
} as const;

export const KS_ID = {
    PORTRAIT: 666,
    BLURITE_SWORD: 667,
    BLURITE_ORE: 668,
    IRON_BAR: 2351,
    IRON_ORE: 440,
    PIE_DISH: 2313,
    PIE_SHELL: 2315,
    UNCOOKED_PIE: 2321,
    REDBERRY_PIE: 2325,
    BURNT_PIE: 2329,
    PASTRY_DOUGH: 1953,
    REDBERRIES: 1951,
    POT_OF_FLOUR: 1933,
    BUCKET: 1925,
    BUCKET_OF_WATER: 1929
} as const;

export const KS_NAME = {
    PORTRAIT: 'Portrait',
    BLURITE_SWORD: 'Blurite sword',
    BLURITE_ORE: 'Blurite ore',
    IRON_BAR: 'Iron bar',
    IRON_ORE: 'Iron ore',
    PIE_DISH: 'Pie dish',
    PIE_SHELL: 'Pie shell',
    UNCOOKED_PIE: 'Uncooked berry pie',
    REDBERRY_PIE: 'Redberry pie',
    BURNT_PIE: 'Burnt pie',
    PASTRY_DOUGH: 'Pastry dough',
    REDBERRIES: 'Redberries',
    POT_OF_FLOUR: 'Pot of flour',
    BUCKET: 'Bucket',
    BUCKET_OF_WATER: 'Bucket of water'
} as const;

export const KS_TILE = {
    FALADOR_BANK: new Tile(2946, 3369, 0),
    FURNACE: new Tile(2975, 3368, 0),
    // Why: this stands south of the cupboard, which spans (2984,3336)-(2985,3336).
    // Why: `forceapproach` is all-blocked with the named side cleared, so `forceapproach=east` means east is the only approach, and the flags rotate with the loc, which is placed at rotation 1.
    // Why: east in the loc's own frame is south in world space, and true east (2986,3336) is not pathable.
    // Why: standing anywhere else has every op silently dropped.
    VYVIN_ROOM: new Tile(2985, 3335, 2),
    /** Far enough to vacate both approaches and let Sir Vyvin wander off them. */
    VYVIN_RETREAT: new Tile(2980, 3340, 2),
    GENERAL_STORE: new Tile(3218, 3415, 0),
    PIE_DISH_SPAWN: new Tile(3222, 3494, 0),
    /** Two tiles from the pie-dish spawn, in the same palace kitchen. */
    KITCHEN_SINK: new Tile(3224, 3494, 0),
    WYDIN: new Tile(3014, 3204, 0),
    RANGE: new Tile(3019, 3237, 0),
    IRON_ROCKS: new Tile(2972, 3239, 0),
    PICKAXE_SPAWN: new Tile(2963, 3216, 0),
    LADDER_BOTTOM: new Tile(3008, 9551, 0)
} as const;

// Why: the cupboard spans (2984,3336)-(2985,3336) and only its south side is legal, so these two tiles are the approach.
// Why: standing on the one further from Sir Vyvin is often the difference between a refused search and a taken one.
export const VYVIN_APPROACHES: readonly Tile[] = [
    new Tile(2985, 3335, 2),
    new Tile(2984, 3335, 2)
];

export const BLURITE_ROCKS: readonly Tile[] = [
    new Tile(3049, 9566, 0),
    new Tile(3059, 9564, 0),
    new Tile(3067, 9581, 0),
    new Tile(3067, 9582, 0)
];

export const SQUIRE: NpcStop = {
    npc: 'Squire',
    anchor: new Tile(2977, 3342, 0),
    leash: 6,
    prefer: [
        'And how is life as a squire?',
        'I can make a new sword if you like',
        'So would these dwarves make another one?',
        "Ok, I'll give it a go."
    ]
};

export const RELDO: NpcStop = {
    npc: 'Reldo',
    anchor: new Tile(3209, 3495, 0),
    leash: 6,
    prefer: ['What do you know about the Imcando dwarves?']
};

/** Ordered by what advances the quest soonest: the pie outranks the sword question. */
export const THURGO: NpcStop = {
    npc: 'Thurgo',
    anchor: new Tile(3001, 3144, 0),
    leash: 6,
    prefer: [
        'Would you like a redberry pie?',
        'Would you like some redberry pie?',
        'About that sword...',
        'Can you make me a special sword?',
        'Hello. Are you an Imcando dwarf?'
    ]
};

export const WYDIN = { npc: 'Wydin', anchor: KS_TILE.WYDIN };

/** Varrock's, not Falador's — the bucket is wanted on the Reldo leg. */
export const GENERAL_STORE = { npc: 'Shop keeper', anchor: KS_TILE.GENERAL_STORE };
