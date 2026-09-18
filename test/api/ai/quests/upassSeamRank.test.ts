import { describe, expect, test } from 'bun:test';

import { orderSeams, seamBucket } from '#/bot/api/ai/quests/defs/upass/rank.js';

// Why: reachable seams must beat closer-looking seams across sealed pocket walls.

const seam = (gains: boolean, open: boolean, dist: number) => ({ gains, open, dist });
const order = (...seams: { gains: boolean; open: boolean; dist: number }[]): number[] =>
    orderSeams(seams, s => s, s => s.dist).map(s => s.dist);

describe('which seam the search tries first', () => {
    test('takes one that gains and this pocket can reach', () => {
        expect(seamBucket({ gains: true, open: true })).toBe(0);
    });

    test('then one this pocket can reach that gains nothing', () => {
        expect(seamBucket({ gains: false, open: true })).toBe(1);
    });

    test('then one that gains behind a wall, and last one that does neither', () => {
        expect(seamBucket({ gains: true, open: false })).toBe(2);
        expect(seamBucket({ gains: false, open: false })).toBe(3);
    });

    test('puts the ledge under the character ahead of every walled bridge', () => {
    // The reachable ledge has less apparent gain than seven walled bridges.
        expect(order(seam(true, false, 21), seam(false, true, 36), seam(true, false, 25)))
            .toEqual([36, 21, 25]);
    });

    test('and behind one that both gains and is reachable', () => {
        expect(order(seam(false, true, 36), seam(true, true, 21))).toEqual([21, 36]);
    });

    test('breaks a tie inside a bucket on distance to the target', () => {
        expect(order(seam(true, true, 30), seam(true, true, 12), seam(true, true, 21)))
            .toEqual([12, 21, 30]);
    });
});
