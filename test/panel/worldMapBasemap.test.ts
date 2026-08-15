import { describe, expect, test } from 'bun:test';
import {
    basemapPxToWorld,
    basemapSourceRect,
    DEFAULT_MAP_ORIGIN,
    DEFAULT_MAP_SIZE,
    isBasemapManifest,
    worldToBasemapPx
} from '#/bot/panel/worldMapBasemap.js';

describe('worldMapBasemap coords', () => {
    const origin = DEFAULT_MAP_ORIGIN;
    const size = DEFAULT_MAP_SIZE;
    const ppt = 1;

    test('origin maps to pixel 0, size.h', () => {
        // world (origin.x, origin.z) is SW corner of map extent in world space for z-up
        // localY = size.h - 0 = size.h when z = origin.z
        const { px, py } = worldToBasemapPx(origin.x, origin.z, origin, size, ppt);
        expect(px).toBe(0);
        expect(py).toBe(size.h);
    });

    test('NE corner of extent', () => {
        const wx = origin.x + size.w;
        const wz = origin.z + size.h;
        const { px, py } = worldToBasemapPx(wx, wz, origin, size, ppt);
        expect(px).toBe(size.w);
        expect(py).toBe(0);
    });

    test('round-trip world ↔ basemap px', () => {
        const samples = [
            { x: 3213, z: 3424 },
            { x: 3222, z: 3218 },
            { x: 2946, z: 3368 }
        ];
        for (const s of samples) {
            const { px, py } = worldToBasemapPx(s.x, s.z, origin, size, ppt);
            const back = basemapPxToWorld(px, py, origin, size, ppt);
            expect(back.x).toBeCloseTo(s.x, 5);
            expect(back.z).toBeCloseTo(s.z, 5);
        }
    });

    test('source rect covers tilesAcross at centre', () => {
        const centreX = 3213;
        const centreZ = 3424;
        const tilesAcross = 320;
        const canvasW = 720;
        const canvasH = 540;
        const r = basemapSourceRect(centreX, centreZ, tilesAcross, canvasW, canvasH, origin, size, ppt);
        expect(r.sw).toBeCloseTo(tilesAcross, 5);
        expect(r.sh).toBeCloseTo((canvasH / canvasW) * tilesAcross, 5);
        // centre of source should map near centre world
        const mid = basemapPxToWorld(r.sx + r.sw / 2, r.sy + r.sh / 2, origin, size, ppt);
        expect(mid.x).toBeCloseTo(centreX, 0);
        expect(mid.z).toBeCloseTo(centreZ, 0);
    });

    test('isBasemapManifest validates shape', () => {
        expect(
            isBasemapManifest({
                schema: 1,
                fingerprint: 'abc',
                origin: { x: 1, z: 2 },
                sizeTiles: { w: 3, h: 4 },
                pixelsPerTile: 1,
                basemapUrl: './x.png'
            })
        ).toBe(true);
        expect(isBasemapManifest({})).toBe(false);
        expect(isBasemapManifest(null)).toBe(false);
    });
});
