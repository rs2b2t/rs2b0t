import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

/** Falador West — nearest era-correct bank to Burthorpe (no Burthorpe bank). */
export const FALADOR_WEST_BANK = new Tile(2946, 3369, 0);

export const DEATH_ITEM = {
    ASGARNIAN_ALE: { id: 1905, name: 'Asgarnian ale' },
    IOU: { id: 3103, name: 'Iou' },
    COMBINATION: { id: 3102, name: 'Combination' },
    SECRET_MAP: { id: 3104, name: 'Secret way map' },
    CLIMBING_BOOTS: { id: 3105, name: 'Climbing boots' },
    SPIKED_BOOTS: { id: 3107, name: 'Spiked boots' },
    ENTRANCE_CERT: { id: 3114, name: 'Certificate' },
    BREAD: { id: 2309, name: 'Bread' },
    TROUT: { id: 333, name: 'Trout' },
    IRON_BAR: { id: 2351, name: 'Iron bar' },
    /** Ground pile (south → north): yellow, green, purple, blue, red. */
    BALL_YELLOW: { id: 3111, name: 'Stone ball', ground: new Tile(2893, 3561, 0) },
    BALL_GREEN: { id: 3113, name: 'Stone ball', ground: new Tile(2893, 3562, 0) },
    BALL_PURPLE: { id: 3112, name: 'Stone ball', ground: new Tile(2893, 3563, 0) },
    BALL_BLUE: { id: 3110, name: 'Stone ball', ground: new Tile(2893, 3564, 0) },
    BALL_RED: { id: 3109, name: 'Stone ball', ground: new Tile(2893, 3565, 0) }
} as const;

/** Correct pedestal placement (use ball id on Stone Mechanism at tile). */
export const PEDESTALS: readonly { ballId: number; color: string; at: Tile }[] = [
    { ballId: DEATH_ITEM.BALL_BLUE.id, color: 'blue', at: new Tile(2894, 3562, 0) },
    { ballId: DEATH_ITEM.BALL_YELLOW.id, color: 'yellow', at: new Tile(2895, 3562, 0) },
    { ballId: DEATH_ITEM.BALL_RED.id, color: 'red', at: new Tile(2894, 3563, 0) },
    { ballId: DEATH_ITEM.BALL_PURPLE.id, color: 'purple', at: new Tile(2895, 3563, 0) },
    { ballId: DEATH_ITEM.BALL_GREEN.id, color: 'green', at: new Tile(2895, 3564, 0) }
];

export const BALL_PICKUP: readonly { id: number; at: Tile }[] = [
    { id: DEATH_ITEM.BALL_YELLOW.id, at: DEATH_ITEM.BALL_YELLOW.ground },
    { id: DEATH_ITEM.BALL_GREEN.id, at: DEATH_ITEM.BALL_GREEN.ground },
    { id: DEATH_ITEM.BALL_PURPLE.id, at: DEATH_ITEM.BALL_PURPLE.ground },
    { id: DEATH_ITEM.BALL_BLUE.id, at: DEATH_ITEM.BALL_BLUE.ground },
    { id: DEATH_ITEM.BALL_RED.id, at: DEATH_ITEM.BALL_RED.ground }
];

export const ALL_BALL_IDS: readonly number[] = BALL_PICKUP.map(b => b.id);

export const TILE = {
    DENULTH: new Tile(2896, 3528, 0),
    EOHRIC: new Tile(2902, 3565, 1),
    HAROLD: new Tile(2905, 3539, 1),
    // Why: (2906,3545) is blocked, and (2907,3544) is the live-reachable approach tile in the hallway north of the door loc.
    // Why: pathing to Harold's tile first makes walkResilient Open the door as a normal transport and leaves the knock mesbox and "Come in!" undrained.
    HAROLD_DOOR: new Tile(2907, 3544, 1),
    HAROLD_DOOR_LOC: new Tile(2906, 3543, 1),
    TOSTIG: new Tile(2910, 3537, 0),
    DUNSTAN: new Tile(2919, 3574, 0),
    TENZING: new Tile(2820, 3556, 0),
    TENZING_DOOR: new Tile(2823, 3555, 0),
    TENZING_BACK: new Tile(2820, 3558, 0),
    SABA_ENTRANCE: new Tile(2858, 3577, 0),
    SABA_INSIDE: new Tile(2270, 4759, 0),
    SABA_EXIT: new Tile(2269, 4752, 0),
    STONE_STAND: new Tile(2894, 3563, 0),
    SCOUT: new Tile(2864, 3608, 0),
    /** Castle large door → courtyard (level 0). */
    CASTLE_DOOR: new Tile(2899, 3558, 0),
    /** Grey board-game staircase stand (Climb-up → L1 near Eohric). loc (2897,3566). */
    CASTLE_STAIRS_BOTTOM: new Tile(2896, 3566, 0),
    CASTLE_STAIRS_TOP: new Tile(2897, 3569, 1),
    /** Toad and Chicken inn staircase stand (Climb-up → Harold L1). loc (2914,3539). */
    INN_STAIRS_BOTTOM: new Tile(2914, 3538, 0),
    INN_STAIRS_TOP: new Tile(2914, 3542, 1)
} as const;

export const TOSTIG_SHOP = { npc: 'Tostig', anchor: TILE.TOSTIG };

export const DENULTH_START: NpcStop = {
    npc: 'Denulth',
    anchor: TILE.DENULTH,
    leash: 8,
    prefer: [
        'Do you have any quests for me?',
        'No but perhaps I could try and find one?',
        // Server already started (setvar / desync) — re-sync client journal colour.
        'Can you remind me of the quest I am on?'
    ]
};

export const DENULTH_FINISH: NpcStop = {
    npc: 'Denulth',
    anchor: TILE.DENULTH,
    leash: 8,
    prefer: []
};

export const EOHRIC_GUARD: NpcStop = {
    npc: 'Eohric',
    anchor: TILE.EOHRIC,
    leash: 8,
    prefer: ["I'm looking for the guard that was on last night."]
};

export const EOHRIC_HAROLD_REFUSED: NpcStop = {
    npc: 'Eohric',
    anchor: TILE.EOHRIC,
    leash: 8,
    prefer: []
};

export const HAROLD_DUTY: NpcStop = {
    npc: 'Harold',
    anchor: TILE.HAROLD,
    leash: 5,
    prefer: ["You're the guard that was on duty last night?"]
};

export const SABA_PATH: NpcStop = {
    npc: 'Saba',
    anchor: TILE.SABA_INSIDE,
    leash: 8,
    prefer: ['Do you know of another way up Death Plateau?']
};

export const TENZING_HELP: NpcStop = {
    npc: 'Tenzing',
    anchor: TILE.TENZING,
    leash: 8,
    prefer: ["OK, I'll get those for you."]
};

export const TENZING_SUPPLIES: NpcStop = {
    npc: 'Tenzing',
    anchor: TILE.TENZING,
    leash: 8,
    prefer: []
};

export const DUNSTAN_SPIKES: NpcStop = {
    npc: 'Dunstan',
    anchor: TILE.DUNSTAN,
    leash: 8,
    prefer: [
        'Tenzing has asked me to bring you his climbing boots',
        'Yes, but I still want them.'
    ]
};

/** death_dice root interface pack id. */
export const DEATH_DICE_MAIN = 6675;
/** death_dice:com_28 — "Roll Dice!" (buttontype=normal / IF_BUTTON). */
export const DEATH_DICE_ROLL_COM = 8421;
/** death_dice:com_30 — "Continue..." after the roll (buttontype=pause / RESUME_PAUSEBUTTON). */
export const DEATH_DICE_CONTINUE_COM = 8423;

export const COIN_FLOAT = 2000;
// Why: Harold starts with 100gp and the content only sets `harold_lostall` (the IOU) when `harold_gold - bet < 0`.
// Why: an exact 100gp win zeros him without the IOU and needs a second win, where betting 101gp bankrupts him on the first.
export const GAMBLE_BET = 101;
export const ALE_PRICE = 5;
