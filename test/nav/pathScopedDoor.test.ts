import { describe, expect, test } from 'bun:test';

import { pickNearbyDoorTile } from '#/bot/nav/exec/doorCrossing.js';

describe('path-scoped nearby door pick (multiloc placement)', () => {
    const me = { x: 100, z: 100, level: 0 };
    // Corridor east along z=100.
    const path = {
        tiles: [
            { x: 100, z: 100, level: 0 },
            { x: 101, z: 100, level: 0 },
            { x: 102, z: 100, level: 0 },
            { x: 103, z: 100, level: 0 },
            { x: 104, z: 100, level: 0 }
        ],
        pathIdx: 0,
        corridor: 1,
        window: 8
    };

    test('prefers door on path corridor over nearer off-path door', () => {
        // Off-path but closer (adjacent south).
        const offPath = { x: 100, z: 99, level: 0 };
        // On path but one step east.
        const onPath = { x: 102, z: 100, level: 0 };
        const pick = pickNearbyDoorTile([offPath, onPath], me, path);
        expect(pick).toEqual(onPath);
    });

    test('falls back to nearest when no path hint', () => {
        const near = { x: 100, z: 99, level: 0 };
        const far = { x: 103, z: 100, level: 0 };
        expect(pickNearbyDoorTile([far, near], me, null)).toEqual(near);
        expect(pickNearbyDoorTile([far, near], me, undefined)).toEqual(near);
    });

    test('ignores other-level doors', () => {
        const onPathL1 = { x: 102, z: 100, level: 1 };
        const near = { x: 100, z: 99, level: 0 };
        expect(pickNearbyDoorTile([onPathL1, near], me, path)).toEqual(near);
    });

    test('empty candidates → null', () => {
        expect(pickNearbyDoorTile([], me, path)).toBeNull();
    });
});
