import { describe, expect, test } from 'bun:test';
import { oilDoses, combinePair, type Stock } from '../../src/bot/scripts/ShadesOfMortton/policy.js';

const stock = (items: Record<number, number> = {}): Stock => new Map(Object.entries({ 995: 10000, 379: 30, ...items }).map(([id, count]) => [Number(id), count]));

describe('Shades supply policy', () => {
    test('accounts for all vial sizes', () => {
        expect(oilDoses(stock({ 3430: 1, 3432: 2, 3434: 1, 3436: 3 }))).toBe(15);
    });
    test('combining two three-dose vials preserves a two-dose remainder', () => {
        expect(combinePair([{ id: 3432, slot: 2 }, { id: 3432, slot: 3 }])).toEqual([2, 3]);
    });
    test('does not pour a vial onto itself or disturb full bottles', () => {
        expect(combinePair([{ id: 3430, slot: 1 }, { id: 3432, slot: 3 }])).toBeNull();
    });
});

test('switches off a completed temple wall even while the previous repair is animating', async () => {
    const { shouldStartWall } = await import('../../src/bot/scripts/ShadesOfMortton/policy.js');
    expect(shouldStartWall('3504,3315:Repair', '3505,3315:Repair', true, false, 0)).toBe(true);
    expect(shouldStartWall('3504,3315:Repair', '3504,3315:Repair', true, false, 8)).toBe(false);
    expect(shouldStartWall(null, '3504,3315:Repair', false, true, 8)).toBe(false);
});
