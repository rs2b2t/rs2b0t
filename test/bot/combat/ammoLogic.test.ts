import { describe, expect, test } from 'bun:test';
import { sweepPlan } from '#/bot/api/combat/AmmoLogic.js';

describe('sweepPlan', () => {
    test('ignores stacks below minStack, keeps the rest nearest-first', () => {
        const plan = sweepPlan(
            [
                { key: 'far-big', count: 9, distance: 8 },
                { key: 'near-big', count: 5, distance: 1 },
                { key: 'near-tiny', count: 1, distance: 0 }
            ],
            { minStack: 3, range: 12, force: false }
        );
        expect(plan).toEqual(['near-big', 'far-big']);
    });

    test('minStack 1 collects everything in range', () => {
        const plan = sweepPlan([{ key: 'a', count: 1, distance: 4 }], { minStack: 1, range: 12, force: false });
        expect(plan).toEqual(['a']);
    });

    test('out-of-range stacks are never swept, even forced', () => {
        const plan = sweepPlan([{ key: 'a', count: 50, distance: 13 }], { minStack: 1, range: 12, force: true });
        expect(plan).toEqual([]);
    });

    test('force takes sub-minStack stacks (quiver empty / leaving field)', () => {
        const plan = sweepPlan([{ key: 'a', count: 1, distance: 2 }], { minStack: 5, range: 12, force: true });
        expect(plan).toEqual(['a']);
    });
});
