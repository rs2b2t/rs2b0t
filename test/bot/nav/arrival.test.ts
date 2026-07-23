import { describe, expect, test } from 'bun:test';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { isArrived, type ArrivalProbe } from '#/bot/nav/arrival.js';

function probe(opts: { canReach?: boolean; walkable?: boolean; canReachAdjacent?: boolean; probeable?: boolean }): ArrivalProbe & { asked: string[] } {
    const asked: string[] = [];
    return {
        asked,
        canReach: (t: NavPoint): boolean => {
            asked.push(`reach ${t.x},${t.z},${t.level}`);
            return opts.canReach ?? false;
        },
        walkable: (t: NavPoint): boolean => {
            asked.push(`walk ${t.x},${t.z},${t.level}`);
            return opts.walkable ?? true;
        },
        canReachAdjacent: (t: NavPoint): boolean => {
            asked.push(`adj ${t.x},${t.z},${t.level}`);
            return opts.canReachAdjacent ?? false;
        },
        probeable: (t: NavPoint): boolean => {
            asked.push(`probe ${t.x},${t.z},${t.level}`);
            return opts.probeable ?? true;
        }
    };
}

const me: NavPoint = { x: 10, z: 10, level: 0 };

describe('isArrived', () => {
    test('within radius + reachable → arrived', () => {
        expect(isArrived(me, { x: 12, z: 10, level: 0 }, 2, probe({ canReach: true, walkable: true }))).toBe(true);
    });

    test('within radius + UNreachable + walkable dest → NOT arrived (H1 money test)', () => {
        expect(isArrived(me, { x: 12, z: 12, level: 0 }, 2, probe({ canReach: false, walkable: true }))).toBe(false);
    });

    test('unwalkable dest with a wall-open adjacent stand → arrived (bank booth)', () => {
        expect(isArrived(me, { x: 12, z: 12, level: 0 }, 2, probe({ canReach: false, walkable: false, canReachAdjacent: true }))).toBe(true);
    });

    test('unwalkable dest through a wall → NOT arrived (ladder-in-a-house money test)', () => {
        expect(isArrived(me, { x: 12, z: 12, level: 0 }, 2, probe({ canReach: false, walkable: false, canReachAdjacent: false, probeable: true }))).toBe(false);
    });

    test('unwalkable dest the scene cannot probe → arrived (Chebyshev fallback survives)', () => {
        expect(isArrived(me, { x: 12, z: 12, level: 0 }, 2, probe({ canReach: false, walkable: false, canReachAdjacent: false, probeable: false }))).toBe(true);
    });

    test('outside radius → NOT arrived regardless of reachability', () => {
        expect(isArrived(me, { x: 15, z: 15, level: 0 }, 2, probe({ canReach: true, walkable: true }))).toBe(false);
        expect(isArrived(me, { x: 15, z: 15, level: 0 }, 2, probe({ canReach: false, walkable: false }))).toBe(false);
    });

    test('level mismatch → NOT arrived even on the exact (x,z) tile & reachable', () => {
        const p = probe({ canReach: true, walkable: true });
        expect(isArrived(me, { x: 10, z: 10, level: 1 }, 2, p)).toBe(false);
        expect(p.asked).toEqual([]);
    });

    test('radius 0 on the exact tile + reachable → arrived', () => {
        expect(isArrived(me, { x: 10, z: 10, level: 0 }, 0, probe({ canReach: true, walkable: true }))).toBe(true);
    });

    test('standing ON dest (cheb 0) → arrived even when the probe says unreachable', () => {
        const p = probe({ canReach: false, walkable: true });
        expect(isArrived(me, { x: 10, z: 10, level: 0 }, 0, p)).toBe(true);
        expect(p.asked).toEqual([]);
    });
});
