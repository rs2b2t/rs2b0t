import Tile from '../../geometry/Tile.js';

export const RAFT_STAND = new Tile(2510, 3493, 0);
export const ROCK_TILE = new Tile(2512, 3468, 0);
export const POST_ROCK = new Tile(2513, 3468, 0);
export const TREE_STAND = new Tile(2512, 3466, 0);
export const LEDGE = new Tile(2511, 3463, 0);
export const LEDGE_DOOR = new Tile(2511, 3464, 0);
export const WASHED_OUT = new Tile(2527, 3413, 0);

// Why: 9892 sees two giants but can take a hit; 9893 is the one-target melee-proof fallback.
export const DEFAULT_SAFESPOT = new Tile(2568, 9892, 0);
export const DEFAULT_SAFESPOT_FALLBACK = new Tile(2568, 9893, 0);
export const DEFAULT_MELEE_TILE = new Tile(2575, 9893, 0);

// Why: only attack targets already in weapon range so the server does not walk off the safespot.
const ATTACK_RANGE: Record<string, number> = { melee: 1, range: 7, mage: 10 };

export function attackRangeFor(style: string, weapon = ''): number {
    if (style === 'range') {
        if (/dart|knife/i.test(weapon)) return 3;
        if (/javelin/i.test(weapon)) return 5;
        if (/thrownaxe/i.test(weapon)) return 4;
        if (/crossbow/i.test(weapon)) return 10;
    }
    return ATTACK_RANGE[style] ?? 1;
}

// Why: prefer east-to-west before distance because a wall blocks the nearest west giant.
interface TargetLike {
    x: number;
    distance: number;
}

export function eastFirst(a: TargetLike, b: TargetLike): number {
    return b.x - a.x || a.distance - b.distance;
}

// Why: gate targets by chamber and keep NPCs fighting someone else reserved through faceEntity gaps.

/** Whether a giant already belongs to someone else's fight. */
interface Engagement {
    isOurs: boolean;
    inCombat: boolean;
    targetsMe: boolean;
    targetsAnother: boolean;
}

export function takenByAnother(e: Engagement): boolean {
    if (e.isOurs) {
        return false;
    }
    return e.targetsAnother || (e.inCombat && !e.targetsMe);
}

// Why: scale pickup wait by distance so safespot recovery does not cancel an in-flight Take.

/** How long to wait for a Take to land, given how far the drop is. */
export function lootWaitMs(distance: number): number {
    return 1200 + Math.max(0, distance) * 700;
}

export type Room = 'west' | 'east';
const WEST_ROOM = { minX: 2556, maxX: 2571, minZ: 9880, maxZ: 9902 };
const EAST_ROOM = { minX: 2572, maxX: 2586, minZ: 9880, maxZ: 9902 };

function inBox(t: PointLike, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    return t.x >= b.minX && t.x <= b.maxX && t.z >= b.minZ && t.z <= b.maxZ;
}

// Why: the chambers overlap inside FIELD_RADIUS, so a drop in the next room reads as nearer than half of our own room's spawns.

/** Whether two points share a chamber, permissive when the reference is not in one. */
export function sameRoom(reference: PointLike | null, other: PointLike | null): boolean {
    const room = roomOf(reference);
    return room === null || roomOf(other) === room;
}

export function roomOf(t: PointLike | null): Room | null {
    if (t === null) {
        return null;
    }
    if (inBox(t, WEST_ROOM)) {
        return 'west';
    }
    return inBox(t, EAST_ROOM) ? 'east' : null;
}

// Why: the exit door sits on the dungeon entry tile and drops you on the ledge, where the barrel ("A wooden barrel, maybe a way off this rock.") washes you to 2527,3413, 118 tiles from Ardougne West.
// Why: that walk-out needs no runes, no magic level and no quest, so a teleport only saves the walk back to the exit door.
export const EXIT_DOOR = new Tile(2575, 9861, 0);
export const EXIT_DOOR_LOC = 'Door';
export const BARREL_LOC = 'Barrel';
export const BARREL_OP = 'Get in';
export const RAFT_LOC = 'Log raft';
export const RAFT_OP = 'Board';
export const ROCK_LOC = 'Rock';
export const TREE_LOC = 'Dead tree';
export const LEDGE_LOC = 'Ledge';
export const LEDGE_OP = 'Open';
export const AMULET = "Glarial's amulet";
export const ROPE = 'Rope';

// engine: inzone(0_39_54_14_20, 0_39_54_18_25). The rope throw is refused outside it
export const THROW_ZONE = { minX: 2510, maxX: 2514, minZ: 3476, maxZ: 3481 };

// the rock is across water, so the op only lands from inside aplocu range; from the
// raft landing (13 tiles) the server answers "I can't reach that!" and nothing happens
export const AP_RANGE = 10;
export const ROPE_THROW_STAND = new Tile(2512, 3477, 0);

export const DUNGEON_MIN_Z = 9000;

interface PointLike {
    x: number;
    z: number;
    level: number;
}

export type Leg = 'InDungeon' | 'AtLedge' | 'PastRock' | 'AtLanding' | 'WashedOut' | 'AtRaft' | 'Surface';

function cheb(a: PointLike, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function legFor(t: PointLike | null): Leg {
    if (t === null) {
        return 'Surface';
    }
    if (t.z > DUNGEON_MIN_Z) {
        return 'InDungeon';
    }
    if (t.x === LEDGE.x && t.z === LEDGE.z) {
        return 'AtLedge';
    }
    if (cheb(t, POST_ROCK) <= 3) {
        return 'PastRock';
    }
    if (t.x >= THROW_ZONE.minX && t.x <= THROW_ZONE.maxX && t.z >= THROW_ZONE.minZ && t.z <= THROW_ZONE.maxZ) {
        return 'AtLanding';
    }
    if (cheb(t, WASHED_OUT) <= 6) {
        return 'WashedOut';
    }
    if (cheb(t, RAFT_STAND) <= 5) {
        return 'AtRaft';
    }
    return 'Surface';
}

export interface EscapeTele {
    name: string;
    level: number;
    runes: { rune: string; count: number }[];
    lands: Tile;
    bank: Tile;
}

export const ESCAPE_TELES: Record<string, EscapeTele> = {
    Camelot: {
        name: 'Camelot', level: 45,
        runes: [{ rune: 'Air rune', count: 5 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(2757, 3478, 0), bank: new Tile(2725, 3491, 0)
    },
    Ardougne: {
        name: 'Ardougne', level: 51,
        runes: [{ rune: 'Water rune', count: 2 }, { rune: 'Law rune', count: 2 }],
        lands: new Tile(2661, 3301, 0), bank: new Tile(2616, 3332, 0)
    },
    Falador: {
        name: 'Falador', level: 37,
        runes: [{ rune: 'Water rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(2965, 3378, 0), bank: new Tile(2946, 3369, 0)
    },
    Varrock: {
        name: 'Varrock', level: 25,
        runes: [{ rune: 'Fire rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(3213, 3424, 0), bank: new Tile(3185, 3440, 0)
    }
};

export const BARREL_EXIT = 'Barrel (free)';
export const EXIT_OPTIONS = [BARREL_EXIT, ...Object.keys(ESCAPE_TELES)];
export const BARREL_BANK = new Tile(2616, 3332, 0); // Ardougne West, 118 tiles from the wash-up
