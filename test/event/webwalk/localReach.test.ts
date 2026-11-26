import { describe, expect, test } from 'bun:test';
import { CollisionFlag } from '#/client/dash3d/CollisionFlag.js';
import { canReachLocal, canStepLocal, localReachProbe, type FlagsAt } from '#/bot/event/webwalk/geometry/localReach.js';

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
        const g: FlagsAt = (lx, lz) => (lx === 1 && lz === 0 ? CollisionFlag.W_W : CollisionFlag._OPEN);
        expect(canStepLocal(g, 0, 0, 1, 0)).toBe(false);
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

describe('localReachProbe', () => {
    test('matches independent searches at each budget in mixed candidate order', () => {
        const from = { lx: 2, lz: 6 };
        for (const wall of [false, true]) {
            const flags: FlagsAt = (x, z) => {
                if (x < 0 || z < 0 || x >= 12 || z >= 12) return null;
                return wall && x === 5 && z !== 2 ? CollisionFlag.WALK_SCENERY : CollisionFlag._OPEN;
            };
            for (const maxSteps of [0, 1, 2, 7, 8, 64, 143, 1200]) {
                const probe = localReachProbe(flags, from, maxSteps);
                for (let i = 0; i < 144; i++) {
                    const k = (i * 31) % 144;
                    const to = { lx: k % 12, lz: Math.floor(k / 12) };
                    expect(probe(to)).toBe(canReachLocal(flags, from, to, { maxSteps }));
                }
            }
        }
    });

    test('later probes use discovery ranks after exhausting the budget', () => {
        let reads = 0;
        const probe = localReachProbe(() => { reads++; return CollisionFlag._OPEN; }, { lx: 5, lz: 5 }, 1);
        expect(probe({ lx: 8, lz: 5 })).toBe(false);
        const exhaustedReads = reads;
        expect(probe({ lx: 4, lz: 5 })).toBe(true);
        expect(probe({ lx: 6, lz: 5 })).toBe(false);
        expect(reads).toBe(exhaustedReads);
    });

    test('a new decision observes a closed passage', () => {
        let blocked = false;
        const flags: FlagsAt = (x, z) => {
            if (x < 0 || x > 2 || z !== 0) return null;
            return blocked && x === 1 ? CollisionFlag.WALK_SCENERY : CollisionFlag._OPEN;
        };
        const from = { lx: 0, lz: 0 };
        const to = { lx: 2, lz: 0 };
        expect(localReachProbe(flags, from, 2)(to)).toBe(true);
        blocked = true;
        expect(localReachProbe(flags, from, 2)(to)).toBe(false);
    });
});
