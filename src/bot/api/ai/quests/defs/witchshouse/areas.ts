import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const WITCHS_HOUSE_QUEST = "Witch's House";

/** Server obj ids. Key, Diary and Ball each name more than one object. */
export const WH_OBJ = {
    GLOVES: 1059,
    CHEESE: 1985,
    BALL: 2407,
    DIARY: 2408,
    DOOR_KEY: 2409,
    MAGNET: 2410,
    SHED_KEY: 2411
} as const;

/** Display names for the 2 steps the engine executes by name. */
export const WH_NAME = {
    GLOVES: 'Leather gloves',
    CHEESE: 'Cheese'
} as const;

export const WH_LOC = {
    FRONT_DOOR: 2861,
    BACK_DOOR: 2862,
    SHED_DOOR: 2863,
    FOUNTAIN: 2864,
    POT: 2867,
    CUPBOARD_SHUT: 2868,
    CUPBOARD_OPEN: 2869,
    MOUSE_HOLE: 2870
} as const;

export const WH_NPC = {
    BOY: 895,
    MOUSE: 901
} as const;

/** The shapeshifter's 4 forms, in the order `witches_experiement.rs2` spawns them. */
export const EXPERIMENT_IDS: readonly number[] = [897, 898, 899, 900];

export const EXPERIMENT_NAMES: readonly string[] = [
    'Witches experiment',
    'Witches experiment second form',
    'Witches experiment third form',
    'Witches experiment fourth form'
];

export const WH_TILE = {
    BOY: new Tile(2928, 3456, 0),
    /** West of the potted plant, which fills its own tile. */
    POT: new Tile(2899, 3474, 0),
    /** East of the cupboard, the side `forceapproach=east` leaves legal at angle 0. */
    CUPBOARD: new Tile(2899, 9873, 0),
    /** Beside the mouse hole, inside the back porch's 4 tiles. */
    PORCH: new Tile(2902, 3466, 0),
    /** East of the diary, which lies on a blocked tile in the upstairs bedroom. */
    DIARY: new Tile(2901, 3473, 1),
    FOUNTAIN: new Tile(2911, 3470, 0),
    /** The garden side of the shed door, on the one-wide east corridor. */
    SHED_DOOR: new Tile(2933, 3463, 0),
    BALL: new Tile(2935, 3461, 0),
    /** Where `witch.rs2` teleports a caught player. */
    THROWN_OUT: new Tile(2929, 3456, 0)
} as const;

export const BOY: NpcStop = {
    npc: 'Boy',
    anchor: WH_TILE.BOY,
    leash: 6,
    prefer: ["What's the matter?", "Ok, I'll see what I can do."]
};

// Why: both keepers carry `op3=Trade`, so the buy step's `Shop.open` reaches the counter without driving the dialogue.
export const WYDIN = { npc: 'Wydin', anchor: new Tile(3014, 3204, 0) };
export const THESSALIA = { npc: 'Thessalia', anchor: new Tile(3204, 3417, 0) };

/** Cheese costs 4 and the gloves 6; this is headroom for the shop multiplier. */
export const SHOP_GP = 200;

export const FALADOR_WEST_BANK = new Tile(2946, 3369, 0);

function within(t: WorldTile | null | undefined, x0: number, x1: number, z0: number, z1: number, level: number): boolean {
    return !!t && t.level === level && t.x >= x0 && t.x <= x1 && t.z >= z0 && t.z <= z1;
}

// Why: a flood over the collision pack puts the walkable garden in 3 strips; the hedges seal everything between them, and the witch's patrol lane is a 4th strip nothing can reach.

/** Past the back door: the ring corridor and the fountain yard it leads to. */
export function inGarden(t: WorldTile | null | undefined): boolean {
    return within(t, 2901, 2933, 3460, 3465, 0)
        || within(t, 2912, 2933, 3466, 3466, 0)
        || within(t, 2908, 2912, 3467, 3475, 0);
}

/** Past the shed door, where the ball and the shapeshifter are. */
export function inShed(t: WorldTile | null | undefined): boolean {
    return within(t, 2934, 2937, 3459, 3467, 0);
}

/** The 4 porch tiles the mouse hole is reachable from. */
export function inPorch(t: WorldTile | null | undefined): boolean {
    return within(t, 2901, 2902, 3466, 3467, 0);
}
