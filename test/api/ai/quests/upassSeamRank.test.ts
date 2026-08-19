import { describe, expect, test } from 'bun:test';

import { orderSeams, seamBucket } from '#/bot/api/ai/quests/defs/upass/rank.js';

// Why: live at (2375,9644), the pocket the mud dig lands in. Its only exit is the ledge at x 2374, which the collision pack agrees leads to a pocket of 153 tiles that walking cannot reach — and by straight line it is thirty-six tiles from the target where standing still is thirty-eight, so it gains nothing. Seven stone bridges at (2392,9627) and up read as twenty tiles of gain and have both sides blocked. Ordering gain first gave every one of those a turn, and ten cages in another cell after them, before the seam the character was standing beside.

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
        // ledge d36, no gain, reachable — against seven stone bridges d21-d38 that gain and are walled
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
