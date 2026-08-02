import { describe, expect, test } from 'bun:test';
import {
    KNOWN_DANGER_ZONES,
    knownDangerZone,
    knownDangerZoneIds,
    resolveDangerZones,
    tileInDangerZones
} from '#/bot/nav/data/dangerZones.js';
import { PathFinder } from '#/bot/nav/PathFinder.js';

/** Minimal pack: mapsquare (0,0) fully walkable levels 0–1. */
function fullyWalkablePack(): Uint8Array {
    const perLevel = 4096 + 512;
    const bytes = new Uint8Array(10 + 3 + 2 * perLevel);
    bytes[0] = 0x4c;
    bytes[1] = 0x43;
    bytes[2] = 0x4e;
    bytes[3] = 0x56;
    bytes[4] = 1;
    bytes[5] = 0;
    bytes[8] = 1;
    let pos = 10;
    bytes[pos++] = 0;
    bytes[pos++] = 0;
    bytes[pos++] = 0b0011;
    for (let level = 0; level < 2; level++) {
        bytes.fill(0xff, pos, pos + 4096);
        pos += 4096;
        bytes.fill(0xff, pos, pos + 512);
        pos += 512;
    }
    return bytes;
}

describe('known danger zones catalog', () => {
    test('includes white-wolf-mountain with a usable rect', () => {
        expect(knownDangerZoneIds()).toContain('white-wolf-mountain');
        const wwm = knownDangerZone('white-wolf-mountain');
        expect(wwm?.label).toMatch(/White Wolf/i);
        expect(wwm?.rects.length).toBeGreaterThan(0);
        const r = wwm!.rects[0]!;
        expect(r.maxX).toBeGreaterThan(r.minX);
        expect(r.maxZ).toBeGreaterThan(r.minZ);
    });

    test('KNOWN_DANGER_ZONES ids are unique', () => {
        const ids = KNOWN_DANGER_ZONES.map(z => z.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('tileInDangerZones', () => {
    const rect = { minX: 10, maxX: 20, minZ: 100, maxZ: 110 };

    test('inclusive bounds on all levels when level omitted', () => {
        expect(tileInDangerZones(10, 100, 0, [rect])).toBe(true);
        expect(tileInDangerZones(20, 110, 2, [rect])).toBe(true);
        expect(tileInDangerZones(9, 100, 0, [rect])).toBe(false);
        expect(tileInDangerZones(15, 111, 0, [rect])).toBe(false);
    });

    test('level-restricted rect only hits that level', () => {
        const ground = { ...rect, level: 0 };
        expect(tileInDangerZones(15, 105, 0, [ground])).toBe(true);
        expect(tileInDangerZones(15, 105, 1, [ground])).toBe(false);
    });

    test('empty / undefined zones never match', () => {
        expect(tileInDangerZones(15, 105, 0, undefined)).toBe(false);
        expect(tileInDangerZones(15, 105, 0, [])).toBe(false);
    });
});

describe('resolveDangerZones', () => {
    test('expands known ids and keeps ad-hoc rects', () => {
        const custom = { minX: 1, maxX: 2, minZ: 3, maxZ: 4, level: 0 };
        const rects = resolveDangerZones(['white-wolf-mountain', custom, 'not-a-real-zone']);
        expect(rects.some(r => r.minX === custom.minX && r.maxZ === custom.maxZ)).toBe(true);
        expect(rects.length).toBeGreaterThanOrEqual(1 + 1); // wwm rect(s) + custom
    });

    test('unknown ids alone yield empty list', () => {
        expect(resolveDangerZones(['nope'])).toEqual([]);
        expect(resolveDangerZones(undefined)).toEqual([]);
    });
});

describe('white wolf sample tiles', () => {
    test('summit corridor is covered; Taverley/Catherby banks are not', () => {
        const zones = resolveDangerZones(['white-wolf-mountain']);
        // Mid-pass (typical wolf path)
        expect(tileInDangerZones(2850, 3495, 0, zones)).toBe(true);
        // Catherby bank
        expect(tileInDangerZones(2809, 3441, 0, zones)).toBe(false);
        // Taverley centre
        expect(tileInDangerZones(2895, 3435, 0, zones)).toBe(false);
    });
});

describe('PathFinder avoidZones', () => {
    test('routes around a band of forbidden tiles', () => {
        const finder = new PathFinder(fullyWalkablePack());
        const from = { x: 5, z: 10, level: 0 };
        const to = { x: 25, z: 10, level: 0 };
        // Vertical strip at x=15, only z 5..15 — room to detour north/south.
        const wall = [{ minX: 15, maxX: 15, minZ: 5, maxZ: 15, level: 0 }];
        const free = finder.findPath(from, to);
        expect(free.ok).toBe(true);
        const blocked = finder.findPath(from, to, { avoidZones: wall });
        expect(blocked.ok).toBe(true);
        if (blocked.ok) {
            for (const wp of blocked.waypoints) {
                expect(wp.x === 15 && wp.z >= 5 && wp.z <= 15 && wp.level === 0).toBe(false);
            }
        }
    });

    test('cannot enter a zone that covers the entire corridor (unreachable)', () => {
        const finder = new PathFinder(fullyWalkablePack());
        const from = { x: 5, z: 10, level: 0 };
        const to = { x: 25, z: 10, level: 0 };
        // Whole mapsquare level 0 is danger — only start tile is "free" by already being there.
        const all = [{ minX: 0, maxX: 63, minZ: 0, maxZ: 63, level: 0 }];
        const out = finder.findPath(from, to, { avoidZones: all });
        // Neighbors are all in zone → no expansion → unreachable
        expect(out.ok).toBe(false);
    });
});
