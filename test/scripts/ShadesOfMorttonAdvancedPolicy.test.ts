import { expect, test } from 'bun:test';
import { burnBatch, huntBatch, expeditionTier } from '../../src/bot/scripts/ShadesOfMortton/advanced-policy.js';

test('plans short unnoting trips while fourteen remains occupy inventory', () => {
    expect(burnBatch(14, 0, 40, 7)).toBe(5);
    expect(burnBatch(14, 0, 40, 3)).toBe(1);
    expect(burnBatch(14, 0, 40, 2)).toBe(0);
});
test('hunting leaves five chest reward slots and respects actual pyres and food', () => {
    expect(huntBatch(14, 0, 40, 19, 4, false)).toBe(14);
    expect(huntBatch(14, 0, 40, 10, 4, false)).toBe(5);
    expect(huntBatch(14, 0, 3, 17, 4, false)).toBe(3);
    expect(huntBatch(14, 0, 40, 17, 1, false)).toBe(0);
    expect(huntBatch(14, 0, 40, 19, 1, true)).toBe(14);
});
test('keeps the highest access key and chooses its next shade tier', () => {
    expect(expeditionTier(new Map([[3450, 1], [3465, 1]]))).toBe(4);
    expect(expeditionTier(new Map())).toBe(0);
});
