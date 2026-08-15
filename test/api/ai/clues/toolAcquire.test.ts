import { describe, expect, test } from 'bun:test';
import { SPADE_NAME, trailKit } from '#/bot/api/ai/clues/data/toolAcquire.js';

describe('trailKit', () => {
    test('non-coord scroll still packs the full standard kit', () => {
        expect(trailKit(2853)).toEqual(['Spade', 'Sextant', 'Watch', 'Chart']);
    });
    test('coordinate scroll packs the same kit', () => {
        expect(trailKit(2801)).toEqual(['Spade', 'Sextant', 'Watch', 'Chart']);
    });
    test('per-clue row items ride along (2811 falls-ledge rope)', () => {
        expect(trailKit(2811)).toEqual(['Spade', 'Sextant', 'Watch', 'Chart', 'Rope']);
    });
    test('the spade is fixed — there is only one digging item', () => {
        expect(trailKit(2853)[0]).toBe(SPADE_NAME);
    });
    test('no scroll (casket-only hold) needs nothing', () => {
        expect(trailKit(null)).toEqual([]);
    });
});
