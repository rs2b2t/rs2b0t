import { describe, expect, test } from 'bun:test';
import { countMatching, matchesAny, shouldBank, shouldEat, shouldPanic, shouldRestock, slotsMatching, type PackItem } from '#/bot/scripts/ArdyFighterLogic.js';

const item = (name: string | null, count = 1): PackItem => ({ name, count });

describe('matchesAny', () => {
    test('case-insensitive name-contains', () => {
        expect(matchesAny('Slice of cake', ['cake'])).toBe(true);
        expect(matchesAny('2/3 cake', ['CAKE'])).toBe(true);
        expect(matchesAny('Chocolate slice', ['cake', 'chocolate slice'])).toBe(true);
    });
    test('null names and empty pattern lists never match', () => {
        expect(matchesAny(null, ['cake'])).toBe(false);
        expect(matchesAny('Cake', [])).toBe(false);
    });
    test('blank patterns are ignored rather than matching everything', () => {
        expect(matchesAny('Cake', ['', '  '])).toBe(false);
    });
});

describe('countMatching', () => {
    test('sums quantities across stacks and slots', () => {
        const pack = [item('Cake'), item('Steel arrow', 40), item('Bones')];
        expect(countMatching(pack, ['cake', 'steel arrow'])).toBe(41);
    });
    test('empty pack counts zero', () => {
        expect(countMatching([], ['cake'])).toBe(0);
    });
});

describe('slotsMatching', () => {
    test('a stack occupies one slot regardless of count', () => {
        const pack = [item('Steel arrow', 40), item('Body talisman'), item('Cake')];
        expect(slotsMatching(pack, ['steel arrow', 'body talisman'])).toBe(2);
    });
    test('empty pack occupies no slots', () => {
        expect(slotsMatching([], ['cake'])).toBe(0);
    });
});

describe('shouldBank', () => {
    test('true at the slot threshold, false below', () => {
        expect(shouldBank(12, 12, false)).toBe(true);
        expect(shouldBank(11, 12, false)).toBe(false);
    });
    test('a full pack banks with any loot but never with none', () => {
        expect(shouldBank(1, 12, true)).toBe(true);
        expect(shouldBank(0, 12, true)).toBe(false);
    });
});

describe('shouldRestock', () => {
    test('strictly below the floor', () => {
        expect(shouldRestock(1, 2)).toBe(true);
        expect(shouldRestock(2, 2)).toBe(false);
    });
});

describe('shouldEat', () => {
    test('below the gate with food in the pack', () => {
        expect(shouldEat(0.49, 0.5, 3)).toBe(true);
        expect(shouldEat(0.5, 0.5, 3)).toBe(false);
        expect(shouldEat(0.49, 0.5, 0)).toBe(false);
    });
});

describe('shouldPanic', () => {
    test('only with zero food below the panic gate', () => {
        expect(shouldPanic(0.2, 0.25, 0)).toBe(true);
        expect(shouldPanic(0.2, 0.25, 1)).toBe(false);
        expect(shouldPanic(0.25, 0.25, 0)).toBe(false);
    });
});
