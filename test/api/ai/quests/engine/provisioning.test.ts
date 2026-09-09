import { expect, test, describe } from 'bun:test';
import { coinFloatWithdraw, coinFloatPlan, depositPlan, floatWithdraw, gpShort, planProvisioning, floatDrawPlan, shouldFreshenPack, buyPurseTopUp, COIN_FLOAT } from '#/bot/api/ai/quests/engine/provisioning.js';
import type { QuestItem } from '#/bot/api/ai/quests/types.js';

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

describe('coinFloatPlan', () => {
    test('a spend-nothing quest never withdraws', () => {
        expect(coinFloatPlan(990, 5000, 0, false)).toEqual({ qty: 0, drawn: true });
        expect(coinFloatPlan(0, 5000, 0, false)).toEqual({ qty: 0, drawn: true });
    });

    test('empty pack, bank covers -> withdraw the full float', () => {
        expect(coinFloatPlan(0, 5000, 1000, false)).toEqual({ qty: 1000, drawn: false });
    });

    test('a pack holding the float is drawn and never revisited', () => {
        expect(coinFloatPlan(1000, 5000, 1000, false)).toEqual({ qty: 0, drawn: true });
    });

    test('a 10gp gate after the float is drawn does not emit a withdraw', () => {
        expect(coinFloatPlan(990, 5000, 1000, false)).toEqual({ qty: 10, drawn: false });
        expect(coinFloatPlan(990, 5000, 1000, true)).toEqual({ qty: 0, drawn: true });
    });
});

describe('floatWithdraw (generalised, e.g. quest food)', () => {
    test('lowercases the lookup, keeps the display name on the withdraw', () => {
        const inv = new Map<string, number>();
        const bank = new Map<string, number>([['trout', 50]]);
        expect(floatWithdraw(inv, bank, 'Trout', 10)).toEqual({ name: 'Trout', qty: 10 });
    });
    test('tops up to target, capped at the bank; null once held or bank dry', () => {
        expect(floatWithdraw(new Map([['trout', 4]]), new Map([['trout', 50]]), 'Trout', 10)).toEqual({ name: 'Trout', qty: 6 });
        expect(floatWithdraw(new Map(), new Map([['trout', 3]]), 'Trout', 10)).toEqual({ name: 'Trout', qty: 3 });
        expect(floatWithdraw(new Map([['trout', 10]]), new Map([['trout', 50]]), 'Trout', 10)).toBeNull();
        expect(floatWithdraw(new Map(), new Map(), 'Trout', 10)).toBeNull();
    });
});

describe('shouldFreshenPack', () => {
    test('a not-started quest with anything in the pack starts by emptying it', () => {
        expect(shouldFreshenPack('notStarted', 28, false)).toBe(true);
        expect(shouldFreshenPack('notStarted', 1, false)).toBe(true);
    });

    test('an empty pack is already fresh', () => {
        expect(shouldFreshenPack('notStarted', 0, false)).toBe(false);
    });

    test('runs once per quest', () => {
        expect(shouldFreshenPack('notStarted', 28, true)).toBe(false);
    });

    // Why: Shield of Arrav resumed at PHOENIX_JOINED had its store key and shield half banked by the session's first sweep, and both the chest and Straven re-check the bank, so neither came back.
    test('a quest already underway keeps its pack, first of the session or not', () => {
        expect(shouldFreshenPack('inProgress', 28, false)).toBe(false);
    });

    test('an unread journal waits rather than banking the pack blind', () => {
        expect(shouldFreshenPack('unknown', 28, false)).toBe(false);
        expect(shouldFreshenPack('complete', 28, false)).toBe(false);
    });
});

describe('floatDrawPlan', () => {
    test('draws the whole float into an empty pack', () => {
        expect(floatDrawPlan(0, 500, 8, false)).toEqual({ qty: 8, drawn: false });
    });

    test('tops up a partial pack on the first pass', () => {
        expect(floatDrawPlan(3, 500, 8, false)).toEqual({ qty: 5, drawn: false });
    });

    test('a pack holding the float is drawn and never revisited', () => {
        expect(floatDrawPlan(8, 500, 8, false)).toEqual({ qty: 0, drawn: true });
        expect(floatDrawPlan(20, 500, 8, false)).toEqual({ qty: 0, drawn: true });
    });

    test('eating into a drawn float does not send the quest back to the bank', () => {
        expect(floatDrawPlan(2, 500, 8, true)).toEqual({ qty: 0, drawn: true });
    });

    test('an empty bank draws nothing and stays undrawn, so a restock is still honoured', () => {
        expect(floatDrawPlan(0, 0, 8, false)).toEqual({ qty: 0, drawn: false });
    });

    test('a short bank draws what it has', () => {
        expect(floatDrawPlan(0, 3, 8, false)).toEqual({ qty: 3, drawn: false });
    });
});

describe('buyPurseTopUp', () => {
    test('a cheap counter still carries a real purse, not the price of one loaf', () => {
        // Why: bread estimates 20 gp. Topping up to 20 left the next boat fare unpayable.
        expect(buyPurseTopUp(0, 20)).toEqual({ need: true, draw: COIN_FLOAT });
    });

    test('the trip is made well below what the quest needs, not at the last coin', () => {
        expect(buyPurseTopUp(COIN_FLOAT / 4 - 1, 20).need).toBe(true);
        expect(buyPurseTopUp(COIN_FLOAT / 4 + 1, 20).need).toBe(false);
    });

    test('a purse that already covers the float is left alone', () => {
        expect(buyPurseTopUp(COIN_FLOAT, 20)).toEqual({ need: false, draw: 0 });
        expect(buyPurseTopUp(50_000, 20)).toEqual({ need: false, draw: 0 });
    });

    test('a counter dearer than the float tops up to the counter', () => {
        expect(buyPurseTopUp(0, 12_000)).toEqual({ need: true, draw: 12_000 });
        expect(buyPurseTopUp(2_000, 12_000)).toEqual({ need: true, draw: 10_000 });
    });

    test('the draw is the shortfall, never the whole target on top of the pack', () => {
        expect(buyPurseTopUp(200, 20).draw).toBe(COIN_FLOAT - 200);
    });
});
