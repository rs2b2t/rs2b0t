// docs/QUESTS.md
import Tile from '../../../../../geometry/Tile.js';
import type { NpcStop } from '../../exec/primitives.js';

export type SheepIndex = 1 | 2 | 3 | 4;

export const SHEEP: readonly SheepIndex[] = [1, 2, 3, 4];

/** Journal ordinals, in `sheepherder_journal.rs2` order. */
export const ORDINAL: Record<SheepIndex, string> = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth' };

// Why: all four sets of remains render "Bones", as does the ordinary drop, so every lookup is by id.
export const BONES_OBJ: Record<SheepIndex, number> = { 1: 280, 2: 281, 3: 282, 4: 283 };

export const PROD_OBJ = 278;
export const FEED_OBJ = 279;
export const JACKET_OBJ = 284;
export const TROUSERS_OBJ = 285;

export const FURNACE_LOC = 165;
export const GATE_LOC: readonly number[] = [166, 167];

export const PROD = 'Prod';
export const FEED = 'Feed';
export const JACKET = 'Plague jacket';
export const TROUSERS = 'Plague trousers';

export const sheepName = (n: SheepIndex): string => `Diseased sheep ${n}`;

export const HALGRIVE: NpcStop = {
    npc: 'Councillor Halgrive',
    anchor: new Tile(2617, 3299, 0),
    leash: 8,
    prefer: ["What's wrong?", 'I can do that for you.']
};

export const ORBON: NpcStop = {
    npc: 'Doctor Orbon',
    anchor: new Tile(2614, 3306, 0),
    leash: 8,
    prefer: ["Ok, I'll take it."]
};

// Why: an npc only enters the client's list within about fifteen tiles, so a sheep two fields away is not "missing" — the leg has to walk to its map spawn before it can look.
export const SHEEP_SPAWN: Record<SheepIndex, Tile> = {
    1: new Tile(2610, 3344, 0),
    2: new Tile(2622, 3367, 0),
    3: new Tile(2561, 3389, 0),
    4: new Tile(2611, 3391, 0)
};

export const BANK = new Tile(2616, 3332, 0);

/** The gate's own tile — `check_axis` runs the clothing branch only from x = 2594. */
export const GATE_OUTSIDE = new Tile(2594, 3361, 0);
/** Where `p_teleport` lands anyone who opens the gate from the west. */
export const GATE_INSIDE = new Tile(2595, 3361, 0);

/** West of the incinerator: `forceapproach=east` rotates with its angle 2 placement. */
export const FURNACE_STAND = new Tile(2604, 3361, 0);

/** The barn spawn, inside the enclosure. */
export const PROD_SPAWN = new Tile(2604, 3357, 0);

interface Box {
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

/** `sheepherder_in_pen`. */
export const PEN: Box = { x0: 2595, x1: 2609, z0: 3351, z1: 3364 };

/** `sheepherder_pen_gate`: prodding a sheep standing here jumps it over the gate. */
export const GATE_ZONE: Box = { x0: 2592, x1: 2594, z0: 3360, z1: 3363 };

export function inBox(box: Box, t: { x: number; z: number; level: number } | null | undefined): boolean {
    return t !== null && t !== undefined && t.level === 0 && t.x >= box.x0 && t.x <= box.x1 && t.z >= box.z0 && t.z <= box.z1;
}
