import { describe, expect, test } from 'bun:test';
import { locHullHeight, resolveLocModelExtents } from '#/bot/adapter/ClientAdapter.js';
import Model from '#/client/dash3d/Model.js';
import ModelSource from '#/client/dash3d/ModelSource.js';
import { PathPublish, formatHopLabel } from '#/bot/event/webwalk/pathPublish.js';
import {
    GAME_VIEW_CLIP,
    buildPathQuads,
    hullFillFromStroke,
    liveTransportLoc,
    projectPathTiles,
    projectTileQuad,
    selectDrawIndices,
    strokeLocHull
} from '#/bot/event/webwalk/pathOverlay.js';

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

describe('locHullHeight', () => {
    test('prefers model.minY (NPC height metric), not maxY or scale', () => {
        expect(locHullHeight({ minY: 200, maxY: 12 })).toBe(200);
        expect(locHullHeight({ minY: 0, maxY: 40 })).toBe(40);
        expect(locHullHeight(null, 96)).toBe(96);
        expect(locHullHeight(undefined)).toBe(128);
    });
});

describe('resolveLocModelExtents', () => {
    test('uses Model instance directly (walls store Model as ModelSource)', () => {
        const m = new Model();
        m.minY = 180;
        m.maxY = 4;
        m.radius = 40;
        expect(resolveLocModelExtents(m)?.minY).toBe(180);
    });
    test('ignores bare ModelSource default minY=1000', () => {
        expect(resolveLocModelExtents(new ModelSource())).toBeNull();
    });
});

describe('liveTransportLoc', () => {
    test('skips teleports and non-scenery kinds (no player-stand cube)', () => {
        expect(
            liveTransportLoc({
                x: 1,
                z: 2,
                level: 0,
                transport: true,
                teleportId: 'varrock',
                locName: 'Varrock teleport',
                locX: 1,
                locZ: 2
            })
        ).toBeNull();
        expect(
            liveTransportLoc({
                x: 1,
                z: 2,
                level: 0,
                transport: true,
                kind: 'teleport',
                locName: 'Castle wars'
            })
        ).toBeNull();
        expect(
            liveTransportLoc({
                x: 1,
                z: 2,
                level: 0,
                transport: true,
                locName: 'Customs officer',
                locX: 1,
                locZ: 2
            })
        ).toBeNull();
    });
});

describe('hullFillFromStroke', () => {
    test('parses rgba stroke into translucent fill', () => {
        expect(hullFillFromStroke('rgba(255, 128, 0, 0.95)', 0.2)).toBe('rgba(255, 128, 0, 0.2)');
        expect(hullFillFromStroke('#ff8800', 0.1)).toBe('rgba(255, 136, 0, 0.1)');
    });
});

describe('strokeLocHull', () => {
    test('draws 12 edges (4+4+4) for a full box', () => {
        const box = [
            { x: 0, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 0 },
            { x: 0, y: 0 },
            { x: 0, y: 8 },
            { x: 10, y: 8 },
            { x: 10, y: -2 },
            { x: 0, y: -2 }
        ];
        let strokes = 0;
        let fills = 0;
        const ctx = {
            save() {},
            restore() {},
            beginPath() {},
            moveTo() {},
            lineTo() {},
            closePath() {},
            stroke() {
                strokes++;
            },
            fill() {
                fills++;
            },
            set strokeStyle(_v: string) {},
            set fillStyle(_v: string) {},
            set lineWidth(_v: number) {},
            set lineJoin(_v: string) {},
            set lineCap(_v: string) {}
        } as unknown as CanvasRenderingContext2D;
        strokeLocHull(ctx, box, 'rgba(1,2,3,1)', 2, { fill: 'rgba(1,2,3,0.1)' });
        expect(strokes).toBe(12);
        expect(fills).toBe(2);
    });
});
