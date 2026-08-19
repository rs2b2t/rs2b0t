import { describe, expect, test } from 'bun:test';

import { arrowAction } from '#/bot/api/ai/quests/defs/ikov/fight.js';

describe('Temple of Ikov arrow supply', () => {
    test('a nocked quiver shoots', () => {
        expect(arrowAction(20, 0, true)).toBe('shoot');
        expect(arrowAction(1, 0, false)).toBe('shoot');
    });

    // Why: the bug this replaced. A sweep puts the recovered arrows in the pack, and a count that
    // Why: added the pack to the quiver read that as armed — every Attack after it answered
    // Why: "There is no ammo left in your quiver" for the rest of the 900-tick guard.
    test('an empty quiver over a full pack nocks rather than shooting', () => {
        expect(arrowAction(0, 12, true)).toBe('nock');
        expect(arrowAction(0, 1, false)).toBe('nock');
    });

    test('an empty quiver and an empty pack sweeps the floor first', () => {
        expect(arrowAction(0, 0, true)).toBe('sweep');
    });

    // Why: 80% of every shot is recoverable, but a sweep that found nothing will find nothing again — a second one is the fight ending, not another circuit.
    test('a sweep that already ran is the end of the fight', () => {
        expect(arrowAction(0, 0, false)).toBe('spent');
    });
});
