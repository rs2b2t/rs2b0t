import { describe, expect, test } from 'bun:test';
import { trailKit } from '#/bot/clues/data/toolAcquire.js';

describe('trailKit', () => {
    test('non-coord scroll still packs the full standard kit', () => {
        // 2853 anagram (talk, no needsSextant): the trio rides along anyway —
        // bank-first runs ONCE per solve and a multi-leg trail can turn
        // coordinate at any later leg (user call 2026-07-20: pull the
        // sextant/watch/chart/spade/coins kit together).
        expect(trailKit(2853)).toEqual(['Spade', 'Sextant', 'Watch', 'Chart']);
    });
    test('coordinate scroll packs the same kit', () => {
        expect(trailKit(2801)).toEqual(['Spade', 'Sextant', 'Watch', 'Chart']);
    });
    test('per-clue row items ride along (2811 falls-ledge rope)', () => {
        expect(trailKit(2811)).toEqual(['Spade', 'Sextant', 'Watch', 'Chart', 'Rope']);
    });
    test('host spade name override is respected', () => {
        expect(trailKit(2853, 'Gilded spade')[0]).toBe('Gilded spade');
    });
    test('no scroll (casket-only hold) needs nothing', () => {
        expect(trailKit(null)).toEqual([]);
    });
});
