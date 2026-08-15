import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const EC_QUEST = 'Ernest the Chicken';

/** `%haunted`, from quest_haunted.constant plus general/configs/quest.constant. */
export const EC_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_ODDENSTEIN: 2,
    COMPLETE: 3
} as const;

export const EC_ID = {
    PRESSURE_GAUGE: 271,
    FISH_FOOD: 272,
    POISON: 273,
    POISONED_FISH_FOOD: 274,
    /** Displays as "Key" — a name shared with a dozen other objects. Match by id. */
    CLOSET_KEY: 275,
    RUBBER_TUBE: 276,
    OIL_CAN: 277,
    SPADE: 952
} as const;

export const EC_NAME = {
    PRESSURE_GAUGE: 'Pressure gauge',
    FISH_FOOD: 'Fish food',
    POISON: 'Poison',
    POISONED_FISH_FOOD: 'Poisoned fish food',
    CLOSET_KEY: 'Key',
    RUBBER_TUBE: 'Rubber tube',
    OIL_CAN: 'Oil can',
    SPADE: 'Spade'
} as const;

export const EC_TILE = {
    DRAYNOR_BANK: new Tile(3093, 3243, 0),
    SPADE_SPAWN: new Tile(3120, 3359, 0),
    POISON_SPAWN: new Tile(3097, 3366, 0),
    FISH_FOOD_SPAWN: new Tile(3108, 3356, 1),
    COMPOST_STAND: new Tile(3085, 3360, 0),
    FOUNTAIN_STAND: new Tile(3087, 3336, 0),
    /** East of the closet door; opening it teleports the player to CLOSET_INSIDE. */
    CLOSET_STAND: new Tile(3107, 3367, 0),
    CLOSET_INSIDE: new Tile(3108, 3367, 0),
    RUBBER_TUBE_SPAWN: new Tile(3111, 3367, 0),
    /** The bookcase refuses anyone west of it, so the stand is on its east side. */
    BOOKCASE_STAND: new Tile(3098, 3358, 0),
    ALCOVE: new Tile(3096, 3358, 0),
    ALCOVE_LEVER: new Tile(3096, 3357, 0),
    LADDER_DOWN_STAND: new Tile(3092, 3363, 0),
    BASEMENT_LANDING: new Tile(3116, 9754, 0),
    LADDER_UP_STAND: new Tile(3117, 9755, 0),
    OIL_CAN_SPAWN: new Tile(3092, 9755, 0)
} as const;

export const VERONICA: NpcStop = {
    npc: 'Veronica',
    anchor: new Tile(3110, 3330, 0),
    leash: 6,
    // The other p_choice2 branch is "No, I'm looking for something to kill."
    prefer: ["Aha, sounds like a quest. I'll help."]
};

/** Both multi2 branches reach oddenstein_not_easy, which sets stage 2. */
export const ODDENSTEIN: NpcStop = {
    npc: 'Professor Oddenstein',
    anchor: new Tile(3110, 3367, 2),
    leash: 6,
    prefer: [
        "I'm looking for a guy called Ernest.",
        'Change him back this instant!',
        "I'm glad Veronica didn't actually get engaged to a chicken."
    ]
};
