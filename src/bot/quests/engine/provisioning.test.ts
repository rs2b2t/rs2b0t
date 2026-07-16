import { expect, test, describe } from 'bun:test';
import { planProvisioning } from './provisioning.js';
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
