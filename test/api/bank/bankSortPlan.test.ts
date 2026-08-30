import { describe, expect, test } from 'bun:test';

import type { BankCategory, SortableItem } from '#/bot/api/bank/bankSortRules.js';
import {
    applyMove,
    longestIncreasingSubsequence,
    planBankSort,
    type BankSortPlan
} from '#/bot/api/bank/bankSortPlan.js';

const COINS = 995;
const AIR_RUNE = 556;
const LAW_RUNE = 563;
const SHARK = 385;
const LOBSTER = 379;
const MITHRIL_ORE = 447;
const JUNK_A = 31337;
const JUNK_B = 31338;

function bank(ids: readonly number[]): SortableItem[] {
    const names: Record<number, string> = {
        [COINS]: 'Coins',
        [AIR_RUNE]: 'Air rune',
        [LAW_RUNE]: 'Law rune',
        [SHARK]: 'Shark',
        [LOBSTER]: 'Lobster',
        [MITHRIL_ORE]: 'Mithril ore',
        [JUNK_A]: 'Nameless thing a',
        [JUNK_B]: 'Nameless thing b'
    };
    const costs: Record<number, number> = {
        [COINS]: 1, [AIR_RUNE]: 4, [LAW_RUNE]: 240,
        [SHARK]: 200, [LOBSTER]: 100, [MITHRIL_ORE]: 81,
        [JUNK_A]: 1, [JUNK_B]: 1
    };
    return ids.map((id, slot) => ({ slot, id, name: names[id] ?? null, cost: costs[id] ?? 0 }));
}

function replay(ids: readonly number[], plan: BankSortPlan): number[] {
    let order = [...ids];
    for (const move of plan.moves) {
        order = applyMove(order, move, plan.mode);
    }
    return order;
}

describe('longestIncreasingSubsequence', () => {
    test('returns the values of a longest run', () => {
        expect(longestIncreasingSubsequence([3, 0, 1, 2])).toEqual([0, 1, 2]);
        expect(longestIncreasingSubsequence([0, 1, 2, 3])).toEqual([0, 1, 2, 3]);
        expect(longestIncreasingSubsequence([3, 2, 1, 0]).length).toBe(1);
        expect(longestIncreasingSubsequence([])).toEqual([]);
    });
});

describe('applyMove', () => {
    test('swap exchanges two slots', () => {
        expect(applyMove([10, 20, 30, 40], { from: 0, to: 2 }, 'swap')).toEqual([30, 20, 10, 40]);
    });

    test('insert shifts right to left, matching insert_bank', () => {
        expect(applyMove([10, 20, 30, 40], { from: 3, to: 0 }, 'insert')).toEqual([40, 10, 20, 30]);
    });

    test('insert shifts left to right, matching insert_bank', () => {
        expect(applyMove([10, 20, 30, 40], { from: 0, to: 2 }, 'insert')).toEqual([20, 30, 10, 40]);
    });
});

describe('planBankSort', () => {
    test('an already sorted bank yields no moves', () => {
        const plan = planBankSort(bank([COINS, LAW_RUNE, AIR_RUNE, SHARK, LOBSTER, MITHRIL_ORE, JUNK_A]));
        expect(plan.moves).toEqual([]);
    });

    test('coins always land in slot 0', () => {
        const ids = [JUNK_A, SHARK, COINS, AIR_RUNE];
        const plan = planBankSort(bank(ids));
        expect(plan.layout[0]).toBe(COINS);
        expect(replay(ids, plan)[0]).toBe(COINS);
    });

    test('junk always lands last', () => {
        const ids = [JUNK_A, SHARK, COINS, JUNK_B, AIR_RUNE];
        const plan = planBankSort(bank(ids));
        expect(plan.layout.slice(-2).sort()).toEqual([JUNK_A, JUNK_B].sort());
    });

    test('within a category the dearer item comes first', () => {
        const plan = planBankSort(bank([LOBSTER, SHARK]));
        expect(plan.layout).toEqual([SHARK, LOBSTER]);
    });

    test('replaying the plan reaches the planned layout', () => {
        const ids = [JUNK_B, MITHRIL_ORE, COINS, LOBSTER, AIR_RUNE, JUNK_A, SHARK, LAW_RUNE];
        const plan = planBankSort(bank(ids));
        expect(replay(ids, plan)).toEqual(plan.layout);
    });

    test('the layout is a permutation of the input', () => {
        const ids = [JUNK_B, MITHRIL_ORE, COINS, LOBSTER, AIR_RUNE, JUNK_A, SHARK, LAW_RUNE];
        const plan = planBankSort(bank(ids));
        expect([...plan.layout].sort()).toEqual([...ids].sort());
    });

    test('unmatched items are reported', () => {
        const plan = planBankSort(bank([COINS, JUNK_A, SHARK]));
        expect(plan.unmatched).toEqual([JUNK_A]);
    });

    test('a bank sorted then topped up picks insert, and one move per new item', () => {
        expect(planBankSort(bank([COINS, LAW_RUNE, AIR_RUNE, SHARK, LOBSTER, MITHRIL_ORE, JUNK_A])).moves).toEqual([]);

        // A law rune deposited after that sort lands at the end and belongs at index 1.
        const ids = [COINS, AIR_RUNE, SHARK, LOBSTER, MITHRIL_ORE, JUNK_A, LAW_RUNE];
        const plan = planBankSort(bank(ids));
        expect(plan.mode).toBe('insert');
        expect(plan.moves.length).toBe(1);
        expect(replay(ids, plan)).toEqual(plan.layout);
    });

    test('a reversed bank picks swap, because inserts cost more there', () => {
        const ids = [JUNK_A, MITHRIL_ORE, LOBSTER, SHARK, AIR_RUNE, LAW_RUNE, COINS];
        const plan = planBankSort(bank(ids));
        expect(plan.mode).toBe('swap');
        expect(replay(ids, plan)).toEqual(plan.layout);
    });

    test('sparse slots produce an empty plan rather than a wrong one', () => {
        const items: SortableItem[] = [
            { slot: 0, id: SHARK, name: 'Shark', cost: 200 },
            { slot: 4, id: COINS, name: 'Coins', cost: 1 }
        ];
        expect(planBankSort(items).moves).toEqual([]);
    });

    test('an empty bank plans nothing', () => {
        expect(planBankSort([]).moves).toEqual([]);
    });

    test('an override outranks the rule table', () => {
        const ids = [COINS, SHARK, LAW_RUNE];
        const overrides = new Map<number, BankCategory>([[SHARK, 'questObsolete']]);
        const plan = planBankSort(bank(ids), { overrides });
        expect(plan.layout).toEqual([COINS, LAW_RUNE, SHARK]);
    });

    test('both plans reach the layout on 200 shuffled banks', () => {
        // Why: a seeded LCG so a failure is reproducible.
        let seed = 12345;
        const next = (): number => {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            return seed;
        };
        const pool = [COINS, AIR_RUNE, LAW_RUNE, SHARK, LOBSTER, MITHRIL_ORE, JUNK_A, JUNK_B];

        for (let round = 0; round < 200; round++) {
            const ids = pool.slice(0, 2 + (next() % (pool.length - 1)));
            for (let i = ids.length - 1; i > 0; i--) {
                const j = next() % (i + 1);
                [ids[i], ids[j]] = [ids[j], ids[i]];
            }

            for (const force of [undefined, 'swap', 'insert'] as const) {
                const plan = planBankSort(bank(ids), force ? { force } : {});
                expect({ round, force, got: replay(ids, plan) })
                    .toEqual({ round, force, got: plan.layout });
            }
        }
    });

    test('the swap plan never beats the cycle bound', () => {
        const ids = [JUNK_B, MITHRIL_ORE, COINS, LOBSTER, AIR_RUNE, JUNK_A, SHARK, LAW_RUNE];
        const plan = planBankSort(bank(ids), { force: 'swap' });
        const stationary = plan.layout.filter((id, i) => id === ids[i]).length;
        expect(plan.moves.length).toBeLessThanOrEqual(ids.length - Math.max(1, stationary));
    });

    test('force pins the mode even when the other is cheaper', () => {
        const ids = [COINS, AIR_RUNE, SHARK, LOBSTER, MITHRIL_ORE, JUNK_A, LAW_RUNE];
        expect(planBankSort(bank(ids)).mode).toBe('insert');

        const forced = planBankSort(bank(ids), { force: 'swap' });
        expect(forced.mode).toBe('swap');
        expect(replay(ids, forced)).toEqual(forced.layout);
    });
});
