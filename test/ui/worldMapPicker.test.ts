import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/nav/PathFinder.js';
import { nearestWalkable, sampleStep } from '#/bot/ui/WorldMapPicker.js';

function loadPack(): PathFinder {
    let bytes = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    return new PathFinder(bytes);
}

describe('sampleStep', () => {
    test('denser at higher zoom', () => {
        expect(sampleStep(8)).toBeLessThan(sampleStep(1));
        expect(sampleStep(0.5)).toBeGreaterThanOrEqual(sampleStep(2));
    });
});

describe('nearestWalkable', () => {
    const finder = loadPack();

    test('identity on walkable bank tiles', () => {
        // Varrock / Edge banks known walkable in pack
        expect(nearestWalkable(finder, 3213, 3424, 0)).toEqual({ x: 3213, z: 3424 });
        expect(nearestWalkable(finder, 3094, 3493, 0)).toEqual({ x: 3094, z: 3493 });
    });

    test('snaps from a blocked neighbour toward walkable', () => {
        // Start on a likely wall/void offset from Lumbridge centre
        const base = { x: 3221, z: 3218 };
        expect(finder.walkable(base.x, base.z, 0)).toBe(true);
        // If we pass a fractional coordinate, still snaps to walkable
        const hit = nearestWalkable(finder, base.x + 0.4, base.z - 0.2, 0);
        expect(hit).not.toBeNull();
        expect(finder.walkable(hit!.x, hit!.z, 0)).toBe(true);
    });
});
