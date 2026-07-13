import { describe, expect, test } from 'bun:test';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { classifyTarget, nearestConnected, type ReachChecker } from '#/bot/nav/coverageLogic.js';

// Stub world: a set of walkable tiles + a set of tiles connected to the anchor.
// key = "x,z,level".
function stub(walkable: Set<string>, connected: Set<string>): ReachChecker {
    const k = (x: number, z: number, l: number): string => `${x},${z},${l}`;
    return {
        walkable: (x, z, l) => walkable.has(k(x, z, l)),
        connected: (from) => connected.has(k(from.x, from.z, from.level))
    };
}
const A: NavPoint = { x: 0, z: 0, level: 0 };

describe('classifyTarget', () => {
    test('unwalkable tile → unwalkable (connectivity not even consulted)', () => {
        const rc = stub(new Set(), new Set(['5,5,0']));
        expect(classifyTarget(rc, { x: 5, z: 5, level: 0 }, A)).toBe('unwalkable');
    });
    test('walkable but not connected → island', () => {
        const rc = stub(new Set(['5,5,0']), new Set());
        expect(classifyTarget(rc, { x: 5, z: 5, level: 0 }, A)).toBe('island');
    });
    test('walkable and connected → ok', () => {
        const rc = stub(new Set(['5,5,0']), new Set(['5,5,0']));
        expect(classifyTarget(rc, { x: 5, z: 5, level: 0 }, A)).toBe('ok');
    });
});

describe('nearestConnected', () => {
    test('returns the nearest walkable+connected ring tile', () => {
        // (5,5) is the island; (6,5) walkable+connected at ring 1.
        const rc = stub(new Set(['5,5,0', '6,5,0']), new Set(['6,5,0']));
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 6)).toEqual({ x: 6, z: 5, level: 0 });
    });
    test('prefers a closer ring over a farther one', () => {
        // ring-1 (5,6) connected AND ring-2 (7,5) connected → ring-1 wins.
        const rc = stub(new Set(['5,6,0', '7,5,0']), new Set(['5,6,0', '7,5,0']));
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 6)).toEqual({ x: 5, z: 6, level: 0 });
    });
    test('a walkable-but-unconnected neighbour is skipped', () => {
        const rc = stub(new Set(['6,5,0', '5,6,0']), new Set(['5,6,0'])); // (6,5) walkable but not connected
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 6)).toEqual({ x: 5, z: 6, level: 0 });
    });
    test('boxed in (nothing connected within maxRing) → null', () => {
        const rc = stub(new Set(['5,5,0']), new Set());
        expect(nearestConnected(rc, { x: 5, z: 5, level: 0 }, A, 3)).toBeNull();
    });
});
