import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/nav/PathFinder.js';
import { cappedSampleStep, nearestWalkable, sampleStep } from '#/bot/ui/WorldMapPicker.js';

const PACK_PATH = 'out/collision.lcnav.gz';
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadPack(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    return new PathFinder(bytes as Uint8Array);
}

describe('sampleStep', () => {
    test('denser at higher zoom', () => {
        expect(sampleStep(8)).toBeLessThan(sampleStep(1));
        expect(sampleStep(0.5)).toBeGreaterThanOrEqual(sampleStep(2));
    });
});

describe('cappedSampleStep', () => {
    test('raises step when the viewport would sample too many tiles', () => {
        // Very zoomed out: large tile span must not use step=1
        const step = cappedSampleStep(0.35, 900, 700, 96);
        expect(step).toBeGreaterThanOrEqual(Math.ceil(900 / 96));
        expect(step).toBeGreaterThan(sampleStep(0.35));
    });

    test('leaves fine step alone when viewport is small', () => {
        expect(cappedSampleStep(8, 40, 30, 96)).toBe(sampleStep(8));
    });
});

describe.skipIf(!HAS_COLLISION_PACK)('nearestWalkable (pack-gated)', () => {
    const finder = HAS_COLLISION_PACK ? loadPack() : null;

    test('identity on walkable bank tiles', () => {
        // Varrock / Edge banks known walkable in pack
        expect(nearestWalkable(finder!, 3213, 3424, 0)).toEqual({ x: 3213, z: 3424 });
        expect(nearestWalkable(finder!, 3094, 3493, 0)).toEqual({ x: 3094, z: 3493 });
    });

    test('snaps from a blocked neighbour toward walkable', () => {
        // Start on a likely wall/void offset from Lumbridge centre
        const base = { x: 3221, z: 3218 };
        expect(finder!.walkable(base.x, base.z, 0)).toBe(true);
        // If we pass a fractional coordinate, still snaps to walkable
        const hit = nearestWalkable(finder!, base.x + 0.4, base.z - 0.2, 0);
        expect(hit).not.toBeNull();
        expect(finder!.walkable(hit!.x, hit!.z, 0)).toBe(true);
    });
});
