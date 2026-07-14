import { describe, expect, test } from 'bun:test';
import type { NavPoint } from '#/bot/nav/PathFinder.js';
import { isArrived, type ArrivalProbe } from '#/bot/nav/arrival.js';

// Stub probe (like coverageLogic.test.ts): fixed answers, and records every
// query so we can prove the short-circuits (level/radius/on-tile) never consult
// the live scene.
function probe(opts: { canReach?: boolean; walkable?: boolean }): ArrivalProbe & { asked: string[] } {
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
        }
    };
}

const me: NavPoint = { x: 10, z: 10, level: 0 };

describe('isArrived', () => {
    test('within radius + reachable → arrived', () => {
        // cheb == radius (2) exactly, reachable → the boundary true-side.
        expect(isArrived(me, { x: 12, z: 10, level: 0 }, 2, probe({ canReach: true, walkable: true }))).toBe(true);
    });

    test('within radius + UNreachable + walkable dest → NOT arrived (H1 money test)', () => {
        // The live Probe-A geometry: 2 tiles (== radius) from a WALKABLE dest
        // across a blocker. Pure Chebyshev said "arrived"; Fix B must refuse.
        expect(isArrived(me, { x: 12, z: 12, level: 0 }, 2, probe({ canReach: false, walkable: true }))).toBe(false);
    });

    test('within radius + unreachable + dest NOT walkable → arrived (booth fallback)', () => {
        // Booth/counter/rock tile: never stand-able, so canReach is always false.
        // Fall back to the old Chebyshev gate — never a never-arrives hang.
        expect(isArrived(me, { x: 12, z: 12, level: 0 }, 2, probe({ canReach: false, walkable: false }))).toBe(true);
    });

    test('outside radius → NOT arrived regardless of reachability', () => {
        expect(isArrived(me, { x: 15, z: 15, level: 0 }, 2, probe({ canReach: true, walkable: true }))).toBe(false);
        expect(isArrived(me, { x: 15, z: 15, level: 0 }, 2, probe({ canReach: false, walkable: false }))).toBe(false);
    });

    test('level mismatch → NOT arrived even on the exact (x,z) tile & reachable', () => {
        const p = probe({ canReach: true, walkable: true });
        expect(isArrived(me, { x: 10, z: 10, level: 1 }, 2, p)).toBe(false);
        expect(p.asked).toEqual([]); // short-circuited before consulting the scene
    });

    test('radius 0 on the exact tile + reachable → arrived', () => {
        expect(isArrived(me, { x: 10, z: 10, level: 0 }, 0, probe({ canReach: true, walkable: true }))).toBe(true);
    });

    test('standing ON dest (cheb 0) → arrived even when the probe says unreachable', () => {
        // canReachLocal(from==to) is degenerate; standing on the tile IS arrival,
        // always — and we must not even consult the probe.
        const p = probe({ canReach: false, walkable: true });
        expect(isArrived(me, { x: 10, z: 10, level: 0 }, 0, p)).toBe(true);
        expect(p.asked).toEqual([]);
    });
});
