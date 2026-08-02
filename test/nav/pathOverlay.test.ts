import { describe, expect, test } from 'bun:test';
import { PathPublish, formatHopLabel } from '#/bot/nav/pathPublish.js';
import {
    GAME_VIEW_CLIP,
    buildPathQuads,
    projectPathTiles,
    projectTileQuad,
    selectDrawIndices
} from '#/bot/nav/pathOverlay.js';

describe('PathPublish', () => {
    test('set update clear', () => {
        PathPublish.clear();
        expect(PathPublish.get()).toBeNull();
        PathPublish.set(
            [
                { x: 1, z: 2, level: 0 },
                { x: 3, z: 4, level: 0, transport: true }
            ],
            0,
            1
        );
        expect(PathPublish.get()?.tiles.length).toBe(2);
        PathPublish.update(1, -1);
        expect(PathPublish.get()?.pathIdx).toBe(1);
        PathPublish.clear();
        expect(PathPublish.get()).toBeNull();
    });
});

describe('GAME_VIEW_CLIP', () => {
    test('matches areaGame blit (512×334 @ 4,4)', () => {
        expect(GAME_VIEW_CLIP).toEqual({ x: 4, y: 4, w: 512, h: 334 });
    });
});

describe('formatHopLabel', () => {
    test('door / ladder action + name', () => {
        expect(formatHopLabel({ locName: 'Door', action: 'Open' })).toBe('Open Door');
        expect(formatHopLabel({ locName: 'Ladder', action: 'Climb-up' })).toBe('Climb-up Ladder');
    });
    test('teleport prefers catalog locName, else prettifies id', () => {
        expect(formatHopLabel({ locName: 'Varrock teleport', action: 'Cast', teleportId: 'varrock' })).toBe(
            'Varrock teleport'
        );
        expect(formatHopLabel({ locName: 'teleport', action: 'Cast', teleportId: 'dueling_arena' })).toBe(
            'Dueling Arena'
        );
    });
});

describe('selectDrawIndices', () => {
    test('near segment is dense, far is subsampled, terminal kept', () => {
        const idx = selectDrawIndices(0, 200, 40, 10);
        expect(idx.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(idx[idx.length - 1]).toBe(199);
        expect(idx.length).toBeLessThanOrEqual(42); // budget + possible terminal
    });
    test('force indices (hops) survive subsampling', () => {
        const idx = selectDrawIndices(0, 100, 15, 5, [50, 90]);
        expect(idx).toContain(50);
        expect(idx).toContain(90);
        expect(idx).toContain(99);
    });
});

describe('projectTileQuad', () => {
    test('returns SW SE NE NW from u/v corners', () => {
        const project = (x: number, z: number, u: number, v: number) => ({
            x: x * 10 + u * 10,
            y: z * 10 + v * 10
        });
        const q = projectTileQuad({ x: 5, z: 7, level: 0 }, project);
        expect(q).not.toBeNull();
        expect(q![0]).toEqual({ x: 50, y: 70 }); // SW
        expect(q![1]).toEqual({ x: 60, y: 70 }); // SE
        expect(q![2]).toEqual({ x: 60, y: 80 }); // NE
        expect(q![3]).toEqual({ x: 50, y: 80 }); // NW
    });

    test('null if any corner fails', () => {
        const project = (_x: number, _z: number, u: number, v: number) =>
            u === 1 && v === 1 ? null : { x: u, y: v };
        expect(projectTileQuad({ x: 0, z: 0, level: 0 }, project)).toBeNull();
    });
});

describe('buildPathQuads', () => {
    test('skips wrong level and failed projections', () => {
        const tiles = [
            { x: 10, z: 10, level: 0 },
            { x: 11, z: 10, level: 1 },
            { x: 12, z: 10, level: 0, transport: true, label: 'Open Gate' }
        ];
        const project = (x: number, z: number, u: number, v: number) => {
            if (x === 10) {
                return null;
            }
            return { x: x * 10 + u, y: z * 10 + v };
        };
        const quads = buildPathQuads(tiles, 0, 0, project);
        expect(quads.length).toBe(1);
        expect(quads[0]!.transport).toBe(true);
        expect(quads[0]!.idx).toBe(2);
        expect(quads[0]!.label).toBe('Open Gate');
    });
});

describe('projectPathTiles (centre-line helper)', () => {
    test('skips null projections and wrong level', () => {
        const tiles = [
            { x: 10, z: 10, level: 0 },
            { x: 11, z: 10, level: 1 },
            { x: 12, z: 10, level: 0, transport: true }
        ];
        const pts = projectPathTiles(tiles, 0, 0, (x, z, level) => {
            if (level !== 0) {
                return null;
            }
            if (x === 10) {
                return null;
            }
            return { x: x * 10, y: z * 10 };
        });
        expect(pts.length).toBe(1);
        expect(pts[0]!.transport).toBe(true);
        expect(pts[0]!.x).toBe(120);
    });
});
