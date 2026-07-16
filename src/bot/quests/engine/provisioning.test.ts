import { expect, test, describe } from 'bun:test';
import { depositPlan, gpShort, planProvisioning } from './provisioning.js';
import type { QuestItem } from '../types.js';

const it = (name: string, qty: number, kind: 'mustHave' | 'acquirable'): QuestItem => ({ name, qty, kind });

describe('planProvisioning', () => {
    test('pack already satisfied -> nothing to do', () => {
        const p = planProvisioning([it('Egg', 1, 'acquirable')], new Map([['egg', 1]]), new Map());
        expect(p.satisfied).toBe(true);
        expect(p.withdraw).toEqual([]);
        expect(p.gather).toEqual([]);
        expect(p.blocked).toEqual([]);
    });

    test('bank-first: banked items are withdrawn, not gathered', () => {
        const p = planProvisioning([it('Clay', 6, 'acquirable')], new Map(), new Map([['clay', 10]]));
        expect(p.withdraw).toEqual([{ name: 'Clay', qty: 6 }]);
        expect(p.gather).toEqual([]);
        expect(p.satisfied).toBe(false);
    });

    test('partial bank tops up from gather', () => {
        const p = planProvisioning([it('Clay', 6, 'acquirable')], new Map([['clay', 1]]), new Map([['clay', 2]]));
        expect(p.withdraw).toEqual([{ name: 'Clay', qty: 2 }]);
        expect(p.gather).toEqual([{ name: 'Clay', need: 3 }]);
    });

    test('mustHave that bank cannot cover blocks; acquirable does not', () => {
        const p = planProvisioning(
            [it('Redberry pie', 1, 'mustHave'), it('Cadava berries', 1, 'acquirable')],
            new Map(),
            new Map()
        );
        expect(p.blocked).toEqual(['Redberry pie x1']);
        expect(p.gather).toEqual([{ name: 'Cadava berries', need: 1 }]);
    });

    test('name matching is case-insensitive against the lowercased maps', () => {
        const p = planProvisioning([it('Ball of wool', 20, 'acquirable')], new Map([['ball of wool', 20]]), new Map());
        expect(p.satisfied).toBe(true);
    });
});

describe('depositPlan', () => {
    const inv = (names: string[]): Map<string, number> => new Map(names.map(n => [n, 1]));

    test('keeps substring matches, deposits the rest', () => {
        const out = depositPlan(inv(['bronze pickaxe', 'logs', 'coins', 'clay']), ['pickaxe', 'clay']);
        expect(out).toEqual(['logs', 'coins']);
    });
    test('clean pack -> nothing to deposit', () => {
        expect(depositPlan(inv(['shears', 'wool']), ['shears', 'wool'])).toEqual([]);
    });
    test('substring keep covers derived forms (cadava berries + cadava potion)', () => {
        expect(depositPlan(inv(['cadava berries', 'cadava potion', 'egg']), ['cadava'])).toEqual(['egg']);
    });
});

describe('gpShort', () => {
    const snapWith = (packCoins: number, bankCoins: number) => ({
        inv: new Map(packCoins > 0 ? [['coins', packCoins]] : []),
        bankCoins
    });
    test('pack + bank covers -> 0', () => {
        expect(gpShort(snapWith(100, 0), 100)).toBe(0);
        expect(gpShort(snapWith(40, 60), 100)).toBe(0);
    });
    test('short -> the exact shortfall', () => {
        expect(gpShort(snapWith(0, 0), 150)).toBe(150);
        expect(gpShort(snapWith(30, 20), 150)).toBe(100);
    });
});
