import { describe, expect, test } from 'bun:test';
import { PathFinder, type TransportEdgeData } from '#/bot/nav/PathFinder.js';

// Minimal v1 LCNV pack: one mapsquare (0,0) with levels 0 and 1, every tile
// walkable and every direction steppable. The two levels share no grid link, so
// the ONLY way between them is whatever transport edge we add — exactly what we
// need to prove a level-change crossing is (or isn't) available to A*.
function fullyWalkablePack(): Uint8Array {
    const perLevel = 4096 + 512; // exit bytes + walk bits
    const bytes = new Uint8Array(10 + 3 + 2 * perLevel);
    bytes[0] = 0x4c; // 'L'
    bytes[1] = 0x43; // 'C'
    bytes[2] = 0x4e; // 'N'
    bytes[3] = 0x56; // 'V'
    bytes[4] = 1; // version
    bytes[5] = 0; // non-members
    bytes[8] = 1; // mapsquare count (uint16 LE)
    let pos = 10;
    bytes[pos++] = 0; // mx
    bytes[pos++] = 0; // mz
    bytes[pos++] = 0b0011; // levelMask: levels 0 and 1 present
    for (let level = 0; level < 2; level++) {
        bytes.fill(0xff, pos, pos + 4096); // exit: all 8 dirs legal on every tile
        pos += 4096;
        bytes.fill(0xff, pos, pos + 512); // walk: every tile walkable
        pos += 512;
    }
    return bytes;
}

describe('PathFinder level-change avoidance', () => {
    const from = { x: 10, z: 10, level: 0 };
    const to = { x: 10, z: 12, level: 1 };
    // a staircase-style crossing: keyed by its from-tile (locX|locZ), toLevel set
    const stair: TransportEdgeData = { from, to, locName: 'Test Staircase', action: 'Climb-up', kind: 'stair' };

    test('level-change transport is used when its key is NOT avoided', () => {
        const finder = new PathFinder(fullyWalkablePack());
        finder.addEdges([], [], [stair]);
        const out = finder.findPath(from, to);
        expect(out.ok).toBe(true);
    });

    // Regression: PathFinder.ts previously exempted `toLevel !== undefined` edges
    // from the avoid set, so a failed staircase re-pathed onto itself forever
    // ("Climb-up Staircase did not resolve, retrying" — Lumbridge castle). A
    // crossing whose key WalkExecutor added after exhausting its retries must now
    // be excluded on repath just like a failed door.
    test('level-change transport is EXCLUDED when its from-tile key is avoided', () => {
        const finder = new PathFinder(fullyWalkablePack());
        finder.addEdges([], [], [stair]);
        const out = finder.findPath(from, to, new Set([`${from.x}|${from.z}`]));
        expect(out.ok).toBe(false); // levels share no other link → unreachable
    });
});

// v2 LCNV pack (wall nibbles present): one mapsquare, level 0 only, all tiles
// walkable and all exits open, with helpers to carve blocked tiles. Blocking a
// tile = clearing its walk bit AND clearing every neighbour's exit bit INTO it
// (search steps are gated by the SOURCE tile's exit byte).
const DX8 = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ8 = [1, 0, -1, 0, 1, -1, -1, 1];

function v2Pack(): { bytes: Uint8Array; blockTile(x: number, z: number): void } {
    const perLevel = 4096 + 512 + 2048;
    const bytes = new Uint8Array(10 + 3 + perLevel);
    bytes[0] = 0x4c; bytes[1] = 0x43; bytes[2] = 0x4e; bytes[3] = 0x56;
    bytes[4] = 2; // version 2 (wall nibbles)
    bytes[5] = 0;
    bytes[8] = 1; // mapsquare count
    bytes[10] = 0; // mx
    bytes[11] = 0; // mz
    bytes[12] = 0b0001; // level 0 only
    const exitBase = 13;
    const walkBase = exitBase + 4096;
    bytes.fill(0xff, exitBase, exitBase + 4096); // all exits open
    bytes.fill(0xff, walkBase, walkBase + 512); // all walkable
    // wall nibbles stay zeroed (no walls — separation is via blocked tiles)
    const idx = (x: number, z: number) => (x & 63) * 64 + (z & 63);
    const blockTile = (x: number, z: number): void => {
        const i = idx(x, z);
        bytes[walkBase + (i >> 3)] &= ~(1 << (i & 7)); // unwalkable
        for (let d = 0; d < 8; d++) {
            const nx = x - DX8[d];
            const nz = z - DZ8[d];
            if (nx < 0 || nz < 0 || nx > 63 || nz > 63) continue;
            bytes[exitBase + idx(nx, nz)] &= ~(1 << d); // neighbour can't step INTO it
        }
    };
    return { bytes, blockTile };
}

describe('wall-aware goal candidates (W4)', () => {
    // A sealed 5x5 "room" (walls = a ring of blocked tiles at x/z 7..13) with an
    // unwalkable "ladder" target at its centre (10,10) and NO door. Interior
    // floor tiles 8..12 stay walkable.
    function roomPack(): Uint8Array {
        const { bytes, blockTile } = v2Pack();
        for (let x = 7; x <= 13; x++) {
            for (let z = 7; z <= 13; z++) {
                const onRing = x === 7 || x === 13 || z === 7 || z === 13;
                if (onRing) blockTile(x, z);
            }
        }
        blockTile(10, 10); // the unwalkable target itself
        return bytes;
    }

    test('outside → interior target: NO wall-blind ring goal (honest unreachable)', () => {
        const finder = new PathFinder(roomPack());
        finder.addEdges([], [], []);
        // Old behavior: the within-5 ring includes tiles OUTSIDE the sealed room
        // (e.g. (5,10)), so the path "succeeded" onto the wrong side of the wall.
        const out = finder.findPath({ x: 2, z: 10, level: 0 }, { x: 10, z: 10, level: 0 });
        expect(out.ok).toBe(false);
    });

    test('inside → interior target: terminates cardinally beside it', () => {
        const finder = new PathFinder(roomPack());
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 9, z: 9, level: 0 }, { x: 10, z: 10, level: 0 });
        expect(out.ok).toBe(true);
        if (out.ok) {
            const t = out.waypoints[out.waypoints.length - 1];
            const cardinal = Math.abs(t.x - 10) + Math.abs(t.z - 10) === 1;
            expect(cardinal).toBe(true);
        }
    });

    test('sealed enclave target in the open: ring fallback keeps it harmless', () => {
        const { bytes, blockTile } = v2Pack();
        // target (30,30) unwalkable and all four cardinals blocked — no
        // connected stand exists (the Varrock-fountain shape)
        blockTile(30, 30);
        blockTile(29, 30);
        blockTile(31, 30);
        blockTile(30, 29);
        blockTile(30, 31);
        const finder = new PathFinder(bytes);
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 2, z: 30, level: 0 }, { x: 30, z: 30, level: 0 });
        expect(out.ok).toBe(true); // reaches a nearby ring tile, as today
    });
});
