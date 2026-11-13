import { describe, expect, test } from 'bun:test';
import { chooseActivity, oilDoses, combinePair, type Stock } from '../../src/bot/scripts/ShadesOfMortton/policy.js';

const stock = (items: Record<number, number> = {}): Stock => new Map(Object.entries({ 995: 10000, 379: 30, ...items }).map(([id, count]) => [Number(id), count]));

describe('Shades supply policy', () => {
    test('gathers food when the bank cannot fund a safe combat trip', () => {
        expect(chooseActivity(stock({ 379: 0 })).kind).toBe('food');
    });
    test('gathers sale stock when coins run out', () => {
        expect(chooseActivity(stock({ 995: 0 })).kind).toBe('funds');
    });
    test('starts with Loar without an access key', () => {
        expect(chooseActivity(stock({ 3448: 8 }))).toEqual({ kind: 'hunt', tier: 0, count: 8 });
    });
    test('a silver key unlocks Fiyr but is not spent', () => {
        expect(chooseActivity(stock({ 3465: 1, 3448: 8 }))).toEqual({ kind: 'hunt', tier: 4, count: 8 });
    });
    test('surplus keys fund supplies before gathering sale stock', () => {
        expect(chooseActivity(stock({ 3465: 2, 995: 0 })).kind).toBe('chests');
    });
    test('burns banked remains before hunting another load', () => {
        expect(chooseActivity(stock({ 3404: 4, 3448: 2, 3465: 1 }))).toEqual({ kind: 'burn', tier: 4, count: 2 });
    });
    test('combines partial sacred oil before buying more', () => {
        expect(chooseActivity(stock({ 1513: 20, 3432: 2 }))).toEqual({ kind: 'make', count: 1 });
    });
    test('collects logs before oil when neither is stocked', () => {
        expect(chooseActivity(stock()).kind).toBe('logs');
    });
    test('collects oil when logs exist but no sacred oil does', () => {
        expect(chooseActivity(stock({ 1513: 8 })).kind).toBe('oil');
    });
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
