import { expect, test, describe } from 'bun:test';
import { coinFloatWithdraw, depositPlan, floatWithdraw, gpShort, planProvisioning } from './provisioning.js';
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

describe('coinFloatWithdraw', () => {
    const packBank = (pack: number, bank: number): [Map<string, number>, Map<string, number>] =>
        [new Map(pack > 0 ? [['coins', pack]] : []), new Map(bank > 0 ? [['coins', bank]] : [])];
    test('empty pack, bank covers -> withdraw the full float', () => {
        const [inv, bank] = packBank(0, 5000);
        expect(coinFloatWithdraw(inv, bank, 1000)).toEqual({ name: 'Coins', qty: 1000 });
    });
    test('partial pack -> tops up to the float', () => {
        const [inv, bank] = packBank(300, 5000);
        expect(coinFloatWithdraw(inv, bank, 1000)).toEqual({ name: 'Coins', qty: 700 });
    });
    test('pack already at/over the float -> null', () => {
        expect(coinFloatWithdraw(...packBank(1000, 5000), 1000)).toBeNull();
        expect(coinFloatWithdraw(...packBank(1500, 5000), 1000)).toBeNull();
    });
    test('bank short -> withdraw only what the bank holds (drains in one trip)', () => {
        const [inv, bank] = packBank(0, 250);
        expect(coinFloatWithdraw(inv, bank, 1000)).toEqual({ name: 'Coins', qty: 250 });
    });
    test('bank dry -> null (no re-withdraw loop)', () => {
        expect(coinFloatWithdraw(...packBank(300, 0), 1000)).toBeNull();
    });
});

describe('floatWithdraw (generalised, e.g. quest food)', () => {
    test('lowercases the lookup, keeps the display name on the withdraw', () => {
        const inv = new Map<string, number>();               // no trout in pack
        const bank = new Map<string, number>([['trout', 50]]); // 50 banked
        expect(floatWithdraw(inv, bank, 'Trout', 10)).toEqual({ name: 'Trout', qty: 10 });
    });
    test('tops up to target, capped at the bank; null once held or bank dry', () => {
        expect(floatWithdraw(new Map([['trout', 4]]), new Map([['trout', 50]]), 'Trout', 10)).toEqual({ name: 'Trout', qty: 6 });
        expect(floatWithdraw(new Map(), new Map([['trout', 3]]), 'Trout', 10)).toEqual({ name: 'Trout', qty: 3 });
        expect(floatWithdraw(new Map([['trout', 10]]), new Map([['trout', 50]]), 'Trout', 10)).toBeNull();
        expect(floatWithdraw(new Map(), new Map(), 'Trout', 10)).toBeNull();
    });
});
