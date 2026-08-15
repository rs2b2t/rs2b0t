import { describe, expect, test } from 'bun:test';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import {
    expandChebyshevSegment,
    expandSegment,
    expandWaypoints,
    localBfsPath,
    remainingPathFromPlayer
} from '#/bot/event/webwalk/geometry/pathExpand.js';
import type { FlagsAt } from '#/bot/event/webwalk/geometry/localReach.js';

/** Open 8×8 pad (all walkable). */
function openFlags(): FlagsAt {
    return (lx, lz) => {
        if (lx < 0 || lz < 0 || lx >= 8 || lz >= 8) {
            return null;
        }
        return CollisionFlag._OPEN;
    };
}

/**
 * Wall on z=2 for x=2..4: blocks north into those tiles from z=1 (and south from z=3).
 * Path (1,1)→(5,1) stays open; (1,1)→(3,4) must detour around the wall.
 */
function wallFlags(): FlagsAt {
    return (lx, lz) => {
        if (lx < 0 || lz < 0 || lx >= 8 || lz >= 8) {
            return null;
        }
        if (lz === 2 && lx >= 2 && lx <= 4) {
            // Cannot enter from south (step north into wall tile)
            return CollisionFlag.PL_WALK_S;
        }
        return CollisionFlag._OPEN;
    };
}

describe('expandChebyshevSegment', () => {
    test('axis-aligned fills each step', () => {
        const s = expandChebyshevSegment({ x: 10, z: 10, level: 0 }, { x: 13, z: 10, level: 0 });
        expect(s).toEqual([
            { x: 11, z: 10, level: 0 },
            { x: 12, z: 10, level: 0 },
            { x: 13, z: 10, level: 0 }
        ]);
    });

    test('uneven diagonal uses max(dx,dz) steps (historical pack paint quirk)', () => {
        // sign(dx)*step overshoots when |dx|!=|dz| — documents why scene BFS is better.
        const s = expandChebyshevSegment({ x: 10, z: 10, level: 0 }, { x: 12, z: 13, level: 0 });
        expect(s).toEqual([
            { x: 11, z: 11, level: 0 },
            { x: 12, z: 12, level: 0 },
            { x: 13, z: 13, level: 0 }
        ]);
    });
});

describe('localBfsPath', () => {
    test('straight line on open map', () => {
        const path = localBfsPath(openFlags(), { lx: 1, lz: 1 }, { lx: 4, lz: 1 });
        expect(path).not.toBeNull();
        expect(path![0]).toEqual({ lx: 1, lz: 1 });
        expect(path![path!.length - 1]).toEqual({ lx: 4, lz: 1 });
        expect(path!.length).toBe(4);
    });

    test('goes around a wall instead of through', () => {
        // Straight east stays clear of the wall at z=2
        const clear = localBfsPath(wallFlags(), { lx: 1, lz: 1 }, { lx: 5, lz: 1 }, 200);
        expect(clear).not.toBeNull();
        expect(clear!.every(p => p.lz === 1)).toBe(true);

        // North through the wall gap: must detour (x=1 or x=5 corridor)
        const path = localBfsPath(wallFlags(), { lx: 3, lz: 1 }, { lx: 3, lz: 4 }, 200);
        expect(path).not.toBeNull();
        expect(path![0]).toEqual({ lx: 3, lz: 1 });
        expect(path![path!.length - 1]).toEqual({ lx: 3, lz: 4 });
        // Never steps onto blocked wall tiles from south into z=2 x=2..4 —
        // path length > 4 (direct would be 4 tiles if open)
        expect(path!.length).toBeGreaterThan(4);
        // Detour uses x≠3 at some point
        expect(path!.some(p => p.lx !== 3)).toBe(true);
    });

    test('null when dest out of flags', () => {
        expect(localBfsPath(openFlags(), { lx: 1, lz: 1 }, { lx: 20, lz: 20 })).toBeNull();
    });
});

describe('remainingPathFromPlayer', () => {
    test('trims to closest tile forward', () => {
        const path = [
            { x: 0, z: 0, level: 0 },
            { x: 1, z: 0, level: 0 },
            { x: 2, z: 0, level: 0 },
            { x: 3, z: 0, level: 0 }
        ];
        const rem = remainingPathFromPlayer(path, { x: 2, z: 0, level: 0 });
        expect(rem.map(t => t.x)).toEqual([2, 3]);
    });
});

describe('expandSegment / expandWaypoints', () => {
    test('without scene uses chebyshev', () => {
        const s = expandSegment({ x: 0, z: 0, level: 0 }, { x: 2, z: 0, level: 0 }, null);
        expect(s).toEqual([
            { x: 1, z: 0, level: 0 },
            { x: 2, z: 0, level: 0 }
        ]);
    });

    test('with open scene uses BFS (same as line)', () => {
        const scene = {
            toLocal: (x: number, z: number) =>
                x >= 0 && z >= 0 && x < 8 && z < 8 ? { lx: x, lz: z } : null,
            flags: openFlags()
        };
        const s = expandSegment({ x: 1, z: 1, level: 0 }, { x: 4, z: 1, level: 0 }, scene);
        expect(s.map(t => `${t.x},${t.z}`)).toEqual(['2,1', '3,1', '4,1']);
    });

    test('transport hop is not interpolated', () => {
        const wps = [
            { x: 0, z: 0, level: 0 },
            { x: 10, z: 10, level: 1, transport: { locName: 'Ladder' } }
        ];
        const tiles = expandWaypoints(wps, null);
        expect(tiles).toHaveLength(2);
        expect(tiles[1]!.transport).toBeDefined();
    });
});
