import { describe, expect, test } from 'bun:test';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/nav/PathFinder.js';

// Synthetic LCNV v2 pack: one mapsquare (mx=mz=50 → world base 3200,3200),
// walkability + wall-edge nibbles from predicates, exit masks from mutual
// walkability minus wall-blocked edges, with the rsmod diagonal rule (a
// diagonal step needs both orthogonal L-routes clear). Matches the
// tools/nav/build-collision.ts layout the PathFinder constructor parses.
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
// wall nibble bit per cardinal dir index (0=N,1=E,2=S,3=W)
const WALL_BIT = [1, 2, 4, 8];
const OPP = [2, 3, 0, 1];

function buildPack(walkableAt: (x: number, z: number) => boolean, wallsAt: (x: number, z: number) => number = () => 0, mx = 50, mz = 50): Uint8Array {
    const exit = new Uint8Array(4096);
    const walk = new Uint8Array(512);
    const wall = new Uint8Array(2048);
    const baseX = mx << 6;
    const baseZ = mz << 6;
    const w = (x: number, z: number): boolean => x >= baseX && x < baseX + 64 && z >= baseZ && z < baseZ + 64 && walkableAt(x, z);
    // a cardinal step x,z -> dir is open when neither side has a wall on the shared edge
    const open = (x: number, z: number, dir: number): boolean => w(x + DX[dir], z + DZ[dir]) && (wallsAt(x, z) & WALL_BIT[dir]) === 0 && (wallsAt(x + DX[dir], z + DZ[dir]) & WALL_BIT[OPP[dir]]) === 0;
    for (let lx = 0; lx < 64; lx++) {
        for (let lz = 0; lz < 64; lz++) {
            const x = baseX + lx;
            const z = baseZ + lz;
            const index = lx * 64 + lz;
            const nib = wallsAt(x, z) & 0xf;
            wall[index >> 1] |= index & 1 ? nib << 4 : nib;
            if (!w(x, z)) {
                continue;
            }
            walk[index >> 3] |= 1 << (index & 0x7);
            let mask = 0;
            for (let dir = 0; dir < 8; dir++) {
                if (dir < 4) {
                    if (open(x, z, dir)) {
                        mask |= 1 << dir;
                    }
                    continue;
                }
                // diagonal: both L-routes must be fully open
                const dxi = DX[dir] === 1 ? 1 : 3; // E or W
                const dzi = DZ[dir] === 1 ? 0 : 2; // N or S
                const viaX = open(x, z, dxi) && open(x + DX[dxi], z, dzi);
                const viaZ = open(x, z, dzi) && open(x, z + DZ[dzi], dxi);
                if (w(x + DX[dir], z + DZ[dir]) && viaX && viaZ) {
                    mask |= 1 << dir;
                }
            }
            exit[index] = mask;
        }
    }
    const out = new Uint8Array(10 + 3 + 4096 + 512 + 2048);
    out.set([0x4c, 0x43, 0x4e, 0x56, 2, 0, 0, 0]);
    new DataView(out.buffer).setUint16(8, 1, true);
    out[10] = mx;
    out[11] = mz;
    out[12] = 1; // level 0 only
    out.set(exit, 13);
    out.set(walk, 13 + 4096);
    out.set(wall, 13 + 4096 + 512);
    return out;
}

/** Same square but serialized as a v1 pack (no wall section). */
function asV1(pack: Uint8Array): Uint8Array {
    const out = pack.slice(0, pack.length - 2048);
    out[4] = 1;
    return out;
}

/** Two-square v2 pack (a surface square and its z+6400 dungeon twin). */
function buildPackTwo(mxA: number, mzA: number, mxB: number, mzB: number, walkableAt: (x: number, z: number) => boolean): Uint8Array {
    const a = buildPack(walkableAt, () => 0, mxA, mzA);
    const b = buildPack(walkableAt, () => 0, mxB, mzB);
    const out = new Uint8Array(10 + 2 * (3 + 4096 + 512 + 2048));
    out.set(a.subarray(0, 10));
    new DataView(out.buffer).setUint16(8, 2, true);
    out.set(a.subarray(10), 10);
    out.set(b.subarray(10), 10 + (a.length - 10));
    return out;
}

// The Varrock diagonal-door house in miniature: an open field with a room
// whose walls are unwalkable tiles, an unwalkable 'box' at BOX inside, and the
// only way in a curated door edge bridging OUTSIDE<->INSIDE across the sealed
// wall tile (3214,3212) — the transports.json multi-tile door pattern.
const BOX = { x: 3212, z: 3212, level: 0 };
const INSIDE = { x: 3213, z: 3212, level: 0 };
const OUTSIDE = { x: 3215, z: 3212, level: 0 };
const START = { x: 3220, z: 3212, level: 0 };

function roomWalkable(x: number, z: number): boolean {
    const onWall = x >= 3210 && x <= 3214 && z >= 3210 && z <= 3214 && (x === 3210 || x === 3214 || z === 3210 || z === 3214);
    const isBox = x === BOX.x && z === BOX.z;
    return !onWall && !isBox;
}

const DOOR_EDGES: TransportEdgeData[] = [
    { from: OUTSIDE, to: INSIDE, locName: 'Door', action: 'Open', kind: 'door' },
    { from: INSIDE, to: OUTSIDE, locName: 'Door', action: 'Open', kind: 'door' }
];

describe('PathFinder goal selection for unwalkable targets', () => {
    test('routes through a door to a cardinal-adjacent tile of a boxed-in target', () => {
        const finder = new PathFinder(buildPack(roomWalkable));
        finder.addEdges([], DOOR_EDGES);
        const r = finder.findPath(START, BOX);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const last = r.waypoints[r.waypoints.length - 1];
        // terminal must be an interact-legal tile: CARDINALLY adjacent to the box
        expect(Math.abs(last.x - BOX.x) + Math.abs(last.z - BOX.z)).toBe(1);
        // and the path must have crossed the door to get there
        expect(r.waypoints.some(wp => wp.transport?.locName === 'Door')).toBe(true);
    });

    test('falls back to the ring when every cardinal-adjacent tile is sealed (enclave)', () => {
        // A TRUE enclave (the Varrock-fountain shape): the target AND every tile
        // cardinally adjacent to it are unwalkable, so no interact-legal stand
        // exists and the wall-aware flood comes back empty. Only then does the
        // ring fall back, keeping the enclave harmless — path must still succeed,
        // terminating outside within 5 tiles of the target. (A sealed room whose
        // interior stands ARE walkable but walled off from outside is now an
        // honest unreachable instead — see the W4 tests in PathFinder.test.ts.)
        const solidBlock = (x: number, z: number): boolean => !(x >= 3210 && x <= 3214 && z >= 3210 && z <= 3214);
        const finder = new PathFinder(buildPack(solidBlock));
        finder.addEdges([], []);
        const r = finder.findPath(START, BOX);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const last = r.waypoints[r.waypoints.length - 1];
        expect(Math.max(Math.abs(last.x - BOX.x), Math.abs(last.z - BOX.z))).toBeLessThanOrEqual(5);
        expect(last.x).toBeGreaterThanOrEqual(3215); // outside the block
    });

    test('walkable target still paths to the exact tile', () => {
        const finder = new PathFinder(buildPack(roomWalkable));
        finder.addEdges([], DOOR_EDGES);
        const to = { x: 3222, z: 3218, level: 0 };
        const r = finder.findPath(START, to);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const last = r.waypoints[r.waypoints.length - 1];
        expect({ x: last.x, z: last.z }).toEqual({ x: to.x, z: to.z });
    });

    test('standing cardinally adjacent to the target already → immediate arrival', () => {
        const finder = new PathFinder(buildPack(roomWalkable));
        finder.addEdges([], DOOR_EDGES);
        const r = finder.findPath(INSIDE, BOX);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        expect(r.cost).toBe(0);
    });
});

// The Seers drawers house (vague006) in miniature: DIRECTIONAL walls — every
// tile stays walkable, wall-edge nibbles carry the blocking — with the drawers
// against the west wall and a straight door in the south wall. The live bug:
// the tile west of the drawers is walkable, cardinal-adjacent, and CHEAPER
// than interior-via-door, but a wall separates it from the drawers, so Search
// silently no-ops there.
const DRAWERS = { x: 3229, z: 3228, level: 0 };
const WRONG_SIDE = { x: 3228, z: 3228 }; // outside, wall on its east edge
const HOUSE = { x0: 3229, x1: 3232, z0: 3227, z1: 3230 };
const DOOR_X = 3231; // door in the south wall: (3231,3226)<->(3231,3227), a doors.json edge bridging the baked wall
const WEST_START = { x: 3220, z: 3228, level: 0 };

function houseWalkable(x: number, z: number): boolean {
    return !(x === DRAWERS.x && z === DRAWERS.z);
}

function houseWalls(x: number, z: number): number {
    let nib = 0;
    const inside = x >= HOUSE.x0 && x <= HOUSE.x1 && z >= HOUSE.z0 && z <= HOUSE.z1;
    if (inside) {
        if (z === HOUSE.z1) nib |= 1; // N
        if (x === HOUSE.x1) nib |= 2; // E
        if (z === HOUSE.z0) nib |= 4; // S (the closed door bakes as a wall too)
        if (x === HOUSE.x0) nib |= 8; // W
    } else {
        if (z === HOUSE.z0 - 1 && x >= HOUSE.x0 && x <= HOUSE.x1) nib |= 1; // facing N into the house
        if (x === HOUSE.x0 - 1 && z >= HOUSE.z0 && z <= HOUSE.z1) nib |= 2; // facing E
        if (z === HOUSE.z1 + 1 && x >= HOUSE.x0 && x <= HOUSE.x1) nib |= 4; // facing S
        if (x === HOUSE.x1 + 1 && z >= HOUSE.z0 && z <= HOUSE.z1) nib |= 8; // facing W
    }
    return nib;
}

const HOUSE_DOOR: DoorEdgeData[] = [{ x: DOOR_X, z: HOUSE.z0 - 1, level: 0, locId: 1530, locName: 'Door', dir: 'N' }];

describe('PathFinder cardinal goals vs directional walls (LCNV v2)', () => {
    test('skips the wall-separated cardinal tile and routes through the door', () => {
        const finder = new PathFinder(buildPack(houseWalkable, houseWalls));
        finder.addEdges(HOUSE_DOOR, []);
        const r = finder.findPath(WEST_START, DRAWERS);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const last = r.waypoints[r.waypoints.length - 1];
        expect({ x: last.x, z: last.z }).not.toEqual(WRONG_SIDE);
        expect(Math.abs(last.x - DRAWERS.x) + Math.abs(last.z - DRAWERS.z)).toBe(1);
        expect(r.waypoints.some(wp => wp.transport?.locName === 'Door')).toBe(true);
    });

    test('v1 pack (no wall data) degrades gracefully: filter inert, wrong side allowed', () => {
        const finder = new PathFinder(asV1(buildPack(houseWalkable, houseWalls)));
        finder.addEdges(HOUSE_DOOR, []);
        const r = finder.findPath(WEST_START, DRAWERS);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const last = r.waypoints[r.waypoints.length - 1];
        expect({ x: last.x, z: last.z }).toEqual(WRONG_SIDE);
    });
});

// Dungeon teleport edges (kind 'dungeon'): the trapdoor script telejumps the
// player z+6400 on the SAME level — the Dwarven Mine (vague009). The edge must
// carry a toTile annotation (the walker waits on proximity, not level change)
// and A* must route through the jump both ways.
describe('PathFinder dungeon teleport edges', () => {
    const SURFACE = { x: 3219, z: 3229, level: 0 };
    const CAVE = SURFACE.z + 6400; // (3219,9629) in the mz+100 twin square
    const DUNGEON_EDGES: TransportEdgeData[] = [
        { from: { x: SURFACE.x, z: SURFACE.z, level: 0 }, to: { x: SURFACE.x, z: CAVE, level: 0 }, locName: 'Trapdoor', action: 'Climb-down', kind: 'dungeon' },
        { from: { x: SURFACE.x, z: CAVE, level: 0 }, to: { x: SURFACE.x, z: SURFACE.z, level: 0 }, locName: 'Ladder', action: 'Climb-up', kind: 'dungeon' }
    ];

    test('routes down through the teleport with a toTile annotation, and back up', () => {
        const finder = new PathFinder(buildPackTwo(50, 50, 50, 150, () => true));
        finder.addEdges([], DUNGEON_EDGES);
        const down = finder.findPath({ x: 3210, z: 3210, level: 0 }, { x: 3230, z: CAVE + 10, level: 0 });
        expect(down.ok).toBe(true);
        if (down.ok) {
            const hop = down.waypoints.find(wp => wp.transport?.locName === 'Trapdoor');
            expect(hop?.transport?.toTile).toEqual({ x: SURFACE.x, z: CAVE });
            expect(down.waypoints[down.waypoints.length - 1].z).toBe(CAVE + 10);
        }
        const up = finder.findPath({ x: 3230, z: CAVE + 10, level: 0 }, { x: 3210, z: 3210, level: 0 });
        expect(up.ok).toBe(true);
        if (up.ok) {
            expect(up.waypoints.some(wp => wp.transport?.toTile?.z === SURFACE.z)).toBe(true);
        }
    });
});
