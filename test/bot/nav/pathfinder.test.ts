import { describe, expect, test } from 'bun:test';
import { PathFinder, type TransportEdgeData } from '#/bot/nav/PathFinder.js';

// Synthetic LCNV v1 pack: one mapsquare (mx=mz=50 → world base 3200,3200),
// walkability from a predicate, exit masks from mutual walkability with the
// rsmod diagonal rule (a diagonal step needs both orthogonals clear). Matches
// the tools/nav/build-collision.ts layout the PathFinder constructor parses.
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];

function buildPack(walkableAt: (x: number, z: number) => boolean, mx = 50, mz = 50): Uint8Array {
    const exit = new Uint8Array(4096);
    const walk = new Uint8Array(512);
    const baseX = mx << 6;
    const baseZ = mz << 6;
    const w = (x: number, z: number): boolean => x >= baseX && x < baseX + 64 && z >= baseZ && z < baseZ + 64 && walkableAt(x, z);
    for (let lx = 0; lx < 64; lx++) {
        for (let lz = 0; lz < 64; lz++) {
            const x = baseX + lx;
            const z = baseZ + lz;
            if (!w(x, z)) {
                continue;
            }
            const index = lx * 64 + lz;
            walk[index >> 3] |= 1 << (index & 0x7);
            let mask = 0;
            for (let dir = 0; dir < 8; dir++) {
                if (!w(x + DX[dir], z + DZ[dir])) {
                    continue;
                }
                if (dir >= 4 && (!w(x + DX[dir], z) || !w(x, z + DZ[dir]))) {
                    continue;
                }
                mask |= 1 << dir;
            }
            exit[index] = mask;
        }
    }
    const out = new Uint8Array(10 + 3 + 4096 + 512);
    out.set([0x4c, 0x43, 0x4e, 0x56, 1, 0, 0, 0]);
    new DataView(out.buffer).setUint16(8, 1, true);
    out[10] = mx;
    out[11] = mz;
    out[12] = 1; // level 0 only
    out.set(exit, 13);
    out.set(walk, 13 + 4096);
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
        // Same room, NO door edge: the interior is a sealed island (the Varrock
        // fountain shape). The ring keeps enclaves harmless — path must still
        // succeed, terminating outside within 5 tiles of the target.
        const finder = new PathFinder(buildPack(roomWalkable));
        finder.addEdges([], []);
        const r = finder.findPath(START, BOX);
        expect(r.ok).toBe(true);
        if (!r.ok) {
            return;
        }
        const last = r.waypoints[r.waypoints.length - 1];
        expect(Math.max(Math.abs(last.x - BOX.x), Math.abs(last.z - BOX.z))).toBeLessThanOrEqual(5);
        expect(last.x).toBeGreaterThanOrEqual(3215); // outside the room
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
