import { describe, expect, test } from 'bun:test';
import { CollisionFlag } from '#/dash3d/CollisionFlag.js';
import { canReachLocal, canStepLocal, type FlagsAt } from './localReach.js';

/** Build a FlagsAt from an ascii grid. '#' = fully blocked, '.' = open.
 *  rows[lz][lx]; out-of-grid = null (out of scene). */
function grid(rows: string[]): FlagsAt {
    return (lx, lz) => {
        const row = rows[lz];
        if (row === undefined || lx < 0 || lx >= row.length) return null;
        return row[lx] === '#' ? CollisionFlag.WALK_SCENERY : CollisionFlag._OPEN;
    };
}

describe('canStepLocal', () => {
    test('open cardinal step allowed', () => {
        const g = grid(['..', '..']);
        expect(canStepLocal(g, 0, 0, 1, 0)).toBe(true);
    });
    test('step into blocked tile denied', () => {
        const g = grid(['.#', '..']);
        expect(canStepLocal(g, 0, 0, 1, 0)).toBe(false);
    });
    test('wall flag on destination blocks entry from that side only', () => {
        // destination (1,0) has a wall on its west side: entering eastward denied
        const g: FlagsAt = (lx, lz) => (lx === 1 && lz === 0 ? CollisionFlag.W_W : CollisionFlag._OPEN);
        expect(canStepLocal(g, 0, 0, 1, 0)).toBe(false);
        // but entering it from the north is fine
        expect(canStepLocal(g, 1, 1, 0, -1)).toBe(true);
    });
    test('diagonal needs both cardinals open', () => {
        const g = grid(['.#', '..']);
        expect(canStepLocal(g, 0, 0, 1, 1)).toBe(false);
    });
    test('out-of-scene is never steppable', () => {
        const g = grid(['..']);
        expect(canStepLocal(g, 0, 0, 0, -1)).toBe(false);
    });
});

describe('canReachLocal', () => {
    test('reaches across an open field', () => {
        const g = grid(['....', '....', '....']);
        expect(canReachLocal(g, { lx: 0, lz: 0 }, { lx: 3, lz: 2 })).toBe(true);
    });
    test('a full wall line is impassable', () => {
        const g = grid(['..#..', '..#..', '..#..']);
        expect(canReachLocal(g, { lx: 0, lz: 1 }, { lx: 4, lz: 1 })).toBe(false);
    });
    test('routes around a partial wall', () => {
        const g = grid(['..#..', '..#..', '.....']);
        expect(canReachLocal(g, { lx: 0, lz: 0 }, { lx: 4, lz: 0 })).toBe(true);
    });
    test('adjacentOk succeeds next to a blocked target tile', () => {
        const g = grid(['..#', '...']);
        expect(canReachLocal(g, { lx: 0, lz: 0 }, { lx: 2, lz: 0 })).toBe(false);
        expect(canReachLocal(g, { lx: 0, lz: 0 }, { lx: 2, lz: 0 }, { adjacentOk: true })).toBe(true);
    });
    test('adjacentOk does NOT succeed across a separating wall', () => {
        const g: FlagsAt = (lx, lz) => {
            if (lz !== 0 || lx < 0 || lx > 2) return null;
            return lx === 1 ? CollisionFlag.W_W | CollisionFlag.W_E : CollisionFlag._OPEN;
        };
        expect(canReachLocal(g, { lx: 0, lz: 0 }, { lx: 1, lz: 0 }, { adjacentOk: true })).toBe(false);
    });
    test('maxSteps caps the search', () => {
        const g = grid(['.'.repeat(60)]);
        expect(canReachLocal(g, { lx: 0, lz: 0 }, { lx: 59, lz: 0 }, { maxSteps: 10 })).toBe(false);
    });
});
