import { describe, expect, test } from 'bun:test';
import { PathFinder, type TransportEdgeData } from './PathFinder.js';

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
