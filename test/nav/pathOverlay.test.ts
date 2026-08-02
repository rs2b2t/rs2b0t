import { describe, expect, test } from 'bun:test';
import { PathPublish } from '#/bot/nav/pathPublish.js';
import { projectPathTiles } from '#/bot/nav/pathOverlay.js';

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

describe('projectPathTiles', () => {
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
