import Tile from '../../../../../geometry/Tile.js';
import type { LadderHop, NpcStop } from '../../exec/primitives.js';

/** Falador West — the nearest bank to both ends of this quest. */
export const FALADOR_WEST_BANK = new Tile(2946, 3369, 0);

export const MC_TILE = {
    COMMANDER: new Tile(2571, 3463, 0),
    TOWER_LADDER: new Tile(2570, 3441, 0),
    TOWER_L1_LADDER: new Tile(2570, 3443, 1),
    TOWER_L2_DOWN: new Tile(2570, 3443, 2),
    TOWER_L1_DOWN: new Tile(2570, 3441, 1),
    REMAINS: new Tile(2567, 3444, 2),
    CAVE_ENTRANCE: new Tile(2622, 3392, 0),
    CAVE_ARRIVE: new Tile(2620, 9797, 0),
    CRATE: new Tile(2571, 9850, 0),
    MUD_PILE: new Tile(2621, 9796, 0),
    MUD_EXIT: new Tile(2623, 3391, 0),
    CANNON: new Tile(2577, 3461, 0),
    NULODION: new Tile(3011, 3453, 0)
} as const;

/** Server loc ids — six broken railings, twenty-four intact ones and both cannon locs all render the same names. */
export const MC_LOC = {
    CRATE: 1,
    CAVE: 2,
    BROKEN_CANNON: 5,
    MUD_PILE: 13,
    RAILING_FIRST: 15,
    RAILING_LAST: 20
} as const;

/** Server obj ids. `Nulodion's notes.` carries a trailing period in its display name. */
export const MC_OBJ = {
    REMAINS: { id: 0, name: 'Dwarf remains' },
    TOOLKIT: { id: 1, name: 'Tool kit' },
    NOTES: { id: 3, name: "Nulodion's notes." },
    MOULD: { id: 4, name: 'Ammo mould' },
    RAILING: { id: 14, name: 'Railing' }
} as const;

/** The six broken railings, walked in this order. The `%mcannonmulti` bit is the loc id minus ten. */
export const RAILINGS: readonly { id: number; at: Tile }[] = [
    { id: 15, at: new Tile(2556, 3475, 0) },
    { id: 16, at: new Tile(2558, 3472, 0) },
    { id: 17, at: new Tile(2557, 3464, 0) },
    { id: 18, at: new Tile(2559, 3462, 0) },
    { id: 19, at: new Tile(2564, 3460, 0) },
    { id: 20, at: new Tile(2572, 3460, 0) }
];

/** The repair menu's four damaged components, in the order the module tries them. */
export const CANNON_PARTS: readonly string[] = ['Pipe', 'Barrel', 'Axle', 'Shaft'];

// Why: one stop covers every Commander conversation, as the three accept lines never share a page and `driveDialog` otherwise takes the last option — which at stage 5 is the refusal.

export const COMMANDER: NpcStop = {
    npc: 'Dwarf Commander',
    anchor: MC_TILE.COMMANDER,
    leash: 8,
    prefer: ["Yeah, I'd love to help.", "Ok, I'll see what I can do.", 'Ok then, just for you!']
};

export const NULODION: NpcStop = {
    npc: 'Nulodion',
    anchor: MC_TILE.NULODION,
    leash: 8,
    prefer: []
};

export const DWARF_CHILD: NpcStop = {
    npc: 'Dwarf youngster',
    anchor: MC_TILE.CRATE,
    leash: 8,
    prefer: []
};

// Why: the cave is entered and left by scripted telejumps that no transports edge carries, so findPath reports the interior unreachable from anywhere outside it.

export const CAVE_HOPS: readonly LadderHop[] = [
    { stand: MC_TILE.CAVE_ENTRANCE, locName: 'Cave Entrance', op: 'Enter', arrive: MC_TILE.CAVE_ARRIVE },
    { stand: MC_TILE.MUD_PILE, locName: 'Mud pile', op: 'Climb-over', arrive: MC_TILE.MUD_EXIT }
];

export const MC_FOOD_TARGET = 8;
