import type { WorldTile } from '../../../../../adapter/ClientAdapter.js';
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export const FC_NAME = 'Fishing Contest';

export const FC_ID = {
    RED_VINE_WORM: 25,
    TROPHY: 26,
    PASS: 27,
    FISHING_ROD: 307,
    RAW_SARDINE: 327,
    RAW_GIANT_CARP: 338,
    SPADE: 952,
    COINS: 995,
    GARLIC: 1550
} as const;

/** Both halves of the Hemenster gate; either one runs the crossing. */
export const FC_LOC = { WALL_PIPE: 41, GATE_LEFT: 47, GATE_RIGHT: 48 } as const;

// Why: the patch is drawn from seven vine shapes that all render "Vine", and other vines elsewhere in the world share the name.

/** The `red_vine` loc category — every diggable vine in McGrubor's Wood. */
export const RED_VINE_LOCS: readonly number[] = [58, 2989, 2990, 2991, 2992, 2993, 2994];

// Why: all four contest spots render "Fishing spot" and stand within fifteen tiles of each other, so only the id separates the winning one from the decoys.
export const FC_NPC = {
    /** Beside the willow tree — sardines at best, whichever bait is used. */
    WILLOW_SPOT: 233,
    /** Beside the pipes — the only spot that yields giant carp. */
    PIPES_SPOT: 234
} as const;

export const FC_TILE = {
    // Why: both stands sit on the left half's row — only that half leaves without Bonzo's "calling it quits" prompt while the quest is merely started.

    /** Morris's side of the fence: the gate only asks for a pass from the east. */
    GATE_OUTSIDE: new Tile(2643, 3442, 0),
    GATE_INSIDE: new Tile(2642, 3442, 0),
    BONZO: new Tile(2640, 3440, 0),
    // Why: `ReachStrategy.reachWallDecor` accepts the loc's own tile, and `reachWallDecor1` has adjacency rules for the diagonal wall-decor shapes alone — a straight one, which the pipes are, is legal from underfoot and nowhere else.

    /** The easternmost pipe's own tile: the only stand its Use accepts. */
    PIPE_STAND: new Tile(2638, 3446, 0),
    PIPES_SPOT: new Tile(2638, 3444, 0),
    /** In the middle of the red-worm patch, with vines on three sides. */
    VINES: new Tile(2632, 3497, 0),
    /** The Falador house floor, on the outbound road. */
    SPADE_FALADOR: new Tile(2981, 3369, 0),
    /** Edmond's house in East Ardougne — the spade to walk back for once the mountain is behind us. */
    SPADE_ARDOUGNE: new Tile(2574, 3331, 0),
    HARRY: new Tile(2834, 3445, 0),
    DWARF_WEST: new Tile(2820, 3486, 0),
    DWARF_EAST: new Tile(2876, 3482, 0)
} as const;

export const HARRY_SHOP = { npc: 'Harry', anchor: FC_TILE.HARRY };

// Why: the start chain is six choices deep and every page repeats "grumpy little man", so the preference list has to name a rung of its own at each step.
export const DWARF_START: NpcStop = {
    npc: 'Mountain Dwarf',
    anchor: FC_TILE.DWARF_WEST,
    leash: 8,
    prefer: [
        'I was just wondering what was down those stairs?',
        'Why not?',
        'If you were my friend I wouldn\'t mind.',
        'Well, let\'s be friends!',
        'And how am I meant to do that?',
        'Fortunately I\'m alright at fishing!'
    ]
};

/** The same dwarf past the start: hands the trophy over, or replaces a lost pass. */
export const DWARF_REPORT: NpcStop = {
    ...DWARF_START,
    prefer: ['I need another competition pass.']
};

export const BONZO_ENTER: NpcStop = {
    npc: 'Bonzo',
    anchor: FC_TILE.BONZO,
    leash: 8,
    prefer: ["I'll enter the competition please."]
};

/** Bonzo with nothing to choose: the hand-over and the spare trophy are both plain chains. */
export const BONZO_REPORT: NpcStop = { ...BONZO_ENTER, prefer: [] };

// Why: the fence seals 184 tiles and the gate is its only edge, so a tile test is an exact "am I past Morris" oracle.

/** Inside the Hemenster competition ground. */
export function inCompound(t: WorldTile | null | undefined): boolean {
    return !!t && t.level === 0 && t.x >= 2628 && t.x <= 2642 && t.z >= 3413 && t.z <= 3446;
}

/** Whichever tunnel mouth is nearer; both dwarves run the same script. */
export function nearestDwarf(t: WorldTile | null | undefined): Tile {
    if (!t) {
        return FC_TILE.DWARF_EAST;
    }
    return FC_TILE.DWARF_WEST.distanceTo(t) <= FC_TILE.DWARF_EAST.distanceTo(t)
        ? FC_TILE.DWARF_WEST
        : FC_TILE.DWARF_EAST;
}

/** The White Wolf Mountain ridge, the only land crossing between Asgarnia and Kandarin. */
const RIDGE_X = 2860;

// Why: straight-line distance picks Falador from Catherby — 146 tiles against Edmond's 261 — and then walks 363 of path over the mountain and its aggressive wolves, where Ardougne is 312 on the flat.

/** The spade spawn on this side of the mountain. */
export function nearestSpade(t: WorldTile | null | undefined): Tile {
    return t && t.x < RIDGE_X ? FC_TILE.SPADE_ARDOUGNE : FC_TILE.SPADE_FALADOR;
}
