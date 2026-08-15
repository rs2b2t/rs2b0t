import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export interface PrinceItem {
    id: number;
    name: string;
}

// Names are the engine's. Wig, Beer, Pot of flour, Logs and Coins each collide with
// another object, so every lookup in this quest goes through the id.
export const PA_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    PRINCE_KEY: { id: 2418, name: 'Bronze key' },
    BLOND_WIG: { id: 2419, name: 'Wig' },
    PLAIN_WIG: { id: 2421, name: 'Wig' },
    KEY_PRINT: { id: 2423, name: 'Key print' },
    PASTE: { id: 2424, name: 'Paste' },
    PINK_SKIRT: { id: 1013, name: 'Pink skirt' },
    ROPE: { id: 954, name: 'Rope' },
    BEER: { id: 1917, name: 'Beer' },
    SOFT_CLAY: { id: 1761, name: 'Soft clay' },
    CLAY: { id: 434, name: 'Clay' },
    YELLOW_DYE: { id: 1765, name: 'Yellow dye' },
    ONION: { id: 1957, name: 'Onion' },
    BALL_OF_WOOL: { id: 1759, name: 'Ball of wool' },
    WOOL: { id: 1737, name: 'Wool' },
    SHEARS: { id: 1735, name: 'Shears' },
    REDBERRIES: { id: 1951, name: 'Redberries' },
    POT_OF_FLOUR: { id: 1933, name: 'Pot of flour' },
    ASHES: { id: 592, name: 'Ashes' },
    TINDERBOX: { id: 590, name: 'Tinderbox' },
    BRONZE_BAR: { id: 2349, name: 'Bronze bar' },
    JUG_OF_WATER: { id: 1937, name: 'Jug of water' },
    LOGS: { id: 1511, name: 'Logs' },
    PICKAXE: { id: 1265, name: 'Bronze pickaxe' }
} as const satisfies Record<string, PrinceItem>;

export const PA_TILE = {
    DRAYNOR_BANK: new Tile(3093, 3243, 0),
    HASSAN: new Tile(3302, 3163, 0),
    OSMAN: new Tile(3286, 3180, 0),
    LEELA: new Tile(3113, 3263, 0),
    NED: new Tile(3100, 3258, 0),
    AGGIE: new Tile(3086, 3259, 0),
    JOE: new Tile(3123, 3245, 0),
    KELI: new Tile(3128, 3244, 0),
    // North of the door: oplocu accepts the key only from the higher z side.
    DOOR_STAND: new Tile(3123, 3244, 0),
    CELL: new Tile(3123, 3243, 0),
    PRINCE: new Tile(3123, 3242, 0),
    BARTENDER: new Tile(3045, 3257, 0),
    LOGS_SPAWN: new Tile(3089, 3265, 0),
    ONION_PATCH: new Tile(3189, 3267, 0),
    SHEEP_PEN: new Tile(3197, 3266, 0),
    SHEARS_SPAWN: new Tile(3152, 3306, 0),
    // forceapproach=south, and the only open side of the Lumbridge wheel.
    SPIN_STAND: new Tile(3209, 3213, 1),
    CLAY_ROCKS: new Tile(2986, 3239, 0),
    PICKAXE_SPAWN: new Tile(2963, 3216, 0)
} as const;

export const PA_SHOP = {
    SHANTAY: { npc: 'Shantay', anchor: new Tile(3304, 3123, 0) },
    LUMBRIDGE: { npc: 'Shop keeper', anchor: new Tile(3209, 3247, 0) },
    THESSALIA: { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) },
    WYDIN: { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) }
} as const;

export const PA_LOC = {
    PRISON_DOOR: 'Prison Door',
    ONION: 'Onion'
} as const;

export const PA_NPC = {
    PRINCE: 'Prince Ali',
    KELI: 'Lady Keli',
    AGGIE: 'Aggie'
} as const;

export const HASSAN_START: NpcStop = {
    npc: 'Hassan',
    anchor: PA_TILE.HASSAN,
    leash: 6,
    prefer: ['Can I help you? You must need some help here in the desert.']
};

export const HASSAN_REWARD: NpcStop = {
    npc: 'Hassan',
    anchor: PA_TILE.HASSAN,
    leash: 6,
    prefer: []
};

// The exit first: osman_second_thing re-offers the first branch, and taking it loops.
export const OSMAN_BRIEF: NpcStop = {
    npc: 'Osman',
    anchor: PA_TILE.OSMAN,
    leash: 6,
    prefer: ['Okay, I better go find some things.', 'What is the second thing you need?']
};

export const OSMAN_FORGE: NpcStop = {
    npc: 'Osman',
    anchor: PA_TILE.OSMAN,
    leash: 6,
    prefer: ['Thank you. I will try to find the other items.']
};

export const LEELA_STOP: NpcStop = {
    npc: 'Leela',
    anchor: PA_TILE.LEELA,
    leash: 6,
    prefer: ['I hoped to get him drunk.', 'I will go and get the rest of the escape equipment.']
};

export const NED_WIG: NpcStop = {
    npc: 'Ned',
    anchor: PA_TILE.NED,
    leash: 6,
    prefer: [
        'Ned, could you make other things from wool?',
        'How about some sort of wig?',
        'I have that now. Please, make me a wig.'
    ]
};

// "Okay, please sell me some rope." must outrank Ned's offer to spin four balls of wool.
export const NED_ROPE: NpcStop = {
    npc: 'Ned',
    anchor: PA_TILE.NED,
    leash: 6,
    prefer: ['Yes, I would like some rope.', 'Okay, please sell me some rope.']
};

export const AGGIE_PASTE: NpcStop = {
    npc: 'Aggie',
    anchor: PA_TILE.AGGIE,
    leash: 6,
    prefer: ['Could you think of a way to make skin paste?', 'Yes please. Mix me some skin paste.']
};

export const KELI_PRINT: NpcStop = {
    npc: 'Lady Keli',
    anchor: PA_TILE.KELI,
    leash: 8,
    prefer: [
        'Heard of you? You are famous in RuneScape!',
        'What is your latest plan then?',
        'Can you be sure they will not try to get him out?',
        'Could I see the key please?',
        'Could I touch the key for a moment?'
    ]
};

export const JOE_BEER: NpcStop = {
    npc: 'Joe',
    anchor: PA_TILE.JOE,
    leash: 6,
    prefer: ['I have some beer here, fancy one?']
};

export const BARTENDER: NpcStop = {
    npc: 'Bartender',
    anchor: PA_TILE.BARTENDER,
    leash: 6,
    prefer: ['Could I buy a beer please?']
};
