import Tile from '../api/Tile.js';

export const RAFT_STAND = new Tile(2510, 3493, 0);
export const RAFT_LANDING = new Tile(2512, 3481, 0);
export const ROCK_TILE = new Tile(2512, 3468, 0);
export const POST_ROCK = new Tile(2513, 3468, 0);
export const TREE_STAND = new Tile(2512, 3466, 0);
export const LEDGE = new Tile(2511, 3463, 0);
export const LEDGE_DOOR = new Tile(2511, 3464, 0);
export const DUNGEON_ENTRY = new Tile(2575, 9861, 0);
export const WASHED_OUT = new Tile(2527, 3413, 0);

// Two-tier: 9892 sees two west giants so it kills faster, but a 2x2 footprint fits
// with its origin on that tile, so a giant can occasionally reach you there. 9893 is
// the melee-proof nook (live-verified: zero pull-offs, zero food eaten) but only
// sees one giant. Hold 9892, drop back to 9893 whenever a giant actually lands on us.
export const DEFAULT_SAFESPOT = new Tile(2568, 9892, 0);
export const DEFAULT_SAFESPOT_FALLBACK = new Tile(2568, 9893, 0);
export const DEFAULT_MELEE_TILE = new Tile(2575, 9893, 0);

// Clicking Attack on a giant beyond weapon range makes the server walk you into
// range, which steps off the safespot — so a target is only engaged once it is
// already close enough to hit from where you stand. Bow figure is the short-bow
// one, which is safe for long bows too; melee just needs adjacency.
export const ATTACK_RANGE: Record<string, number> = { melee: 1, range: 7, mage: 10 };

export function attackRangeFor(style: string): number {
    return ATTACK_RANGE[style] ?? 1;
}

// Distance is the wrong ordering in the west room. The giants wander up to 3 tiles,
// so the westmost one often reads as nearest while a wall blocks line of sight — the
// bot picks it, cannot hit it, and dances. Engage east-to-west, nearest breaking ties.
export interface TargetLike {
    x: number;
    distance: number;
}

export function eastFirst(a: TargetLike, b: TargetLike): number {
    return b.x - a.x || a.distance - b.distance;
}

// The chambers split cleanly on x: west spawns top out at 2568, east ones start at
// 2573. Distance cannot separate them — from the safespot the nearest east giant is
// closer than two of the three west ones — so targeting is gated on room, not range.
/**
 * Whether a giant already belongs to someone else's fight.
 *
 * `targetsAnotherPlayer` alone is not enough: an NPC's faceEntity clears between its
 * attacks, so a giant another player is mid-fight with reads as free for a tick and
 * the bot dives on it. Treating "in combat but not with us" as taken closes that gap.
 * Our own target is always exempt, because its faceEntity flickers the same way and
 * dropping it on that would churn targets every few ticks.
 */
export interface Engagement {
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

export type Room = 'west' | 'east';
export const WEST_ROOM = { minX: 2556, maxX: 2571, minZ: 9880, maxZ: 9902 };
export const EAST_ROOM = { minX: 2572, maxX: 2586, minZ: 9880, maxZ: 9902 };

function inBox(t: PointLike, b: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
    return t.x >= b.minX && t.x <= b.maxX && t.z >= b.minZ && t.z <= b.maxZ;
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

// The dungeon DOES have a walk-out. The exit door sits on the entry tile and drops
// you on the ledge, where the barrel ("A wooden barrel, maybe a way off this rock.")
// washes you to 2527,3413 — 118 tiles from Ardougne West. No runes, no magic level,
// no quest. A teleport only saves the walk back to the exit door.
export const EXIT_DOOR = new Tile(2575, 9861, 0);
export const EXIT_DOOR_LOC = 'Door';
export const BARREL_LOC = 'Barrel';
export const BARREL_OP = 'Get in';
export const BARREL_TILE = new Tile(2512, 3463, 0);

export const RAFT_LOC = 'Log raft';
export const RAFT_OP = 'Board';
export const ROCK_LOC = 'Rock';
export const TREE_LOC = 'Dead tree';
export const LEDGE_LOC = 'Ledge';
export const LEDGE_OP = 'Open';
export const AMULET = "Glarial's amulet";
export const ROPE = 'Rope';

// engine: inzone(0_39_54_14_20, 0_39_54_18_25) — the rope throw is refused outside it
export const THROW_ZONE = { minX: 2510, maxX: 2514, minZ: 3476, maxZ: 3481 };

// the rock is across water, so the op only lands from inside aplocu range; from the
// raft landing (13 tiles) the server answers "I can't reach that!" and nothing happens
export const AP_RANGE = 10;
export const ROPE_THROW_STAND = new Tile(2512, 3477, 0);

export const DUNGEON_MIN_Z = 9000;

export interface PointLike {
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
    com: number;
    level: number;
    runes: { rune: string; count: number }[];
    lands: Tile;
    bank: Tile;
}

export const ESCAPE_TELES: Record<string, EscapeTele> = {
    Camelot: {
        name: 'Camelot', com: 1174, level: 45,
        runes: [{ rune: 'Air rune', count: 5 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(2757, 3478, 0), bank: new Tile(2725, 3491, 0)
    },
    Ardougne: {
        name: 'Ardougne', com: 1540, level: 51,
        runes: [{ rune: 'Water rune', count: 2 }, { rune: 'Law rune', count: 2 }],
        lands: new Tile(2661, 3301, 0), bank: new Tile(2616, 3332, 0)
    },
    Falador: {
        name: 'Falador', com: 1170, level: 37,
        runes: [{ rune: 'Water rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(2965, 3378, 0), bank: new Tile(2946, 3369, 0)
    },
    Varrock: {
        name: 'Varrock', com: 1164, level: 25,
        runes: [{ rune: 'Fire rune', count: 1 }, { rune: 'Air rune', count: 3 }, { rune: 'Law rune', count: 1 }],
        lands: new Tile(3213, 3424, 0), bank: new Tile(3185, 3440, 0)
    }
};

export const BARREL_EXIT = 'Barrel (free)';
export const EXIT_OPTIONS = [BARREL_EXIT, ...Object.keys(ESCAPE_TELES)];
export const BARREL_BANK = new Tile(2616, 3332, 0); // Ardougne West, 118 tiles from the wash-up
export const ESCAPE_TELE_OPTIONS = Object.keys(ESCAPE_TELES);
