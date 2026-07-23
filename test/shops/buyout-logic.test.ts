import { describe, expect, test } from 'bun:test';
import { buyoutPlan } from '#/bot/shops/BuyoutLogic.js';
import type { ShopRecord } from '#/bot/shops/types.js';

const REC: ShopRecord = {
    inv: 'magearena_runeshop', title: '', keepers: ['Lundail'], sell: 1000, buy: 550, delta: 30, scope: 'shared', allstock: false,
    items: [
        { obj: 'mindrune', name: 'Mind rune', baseline: 140, restockTicks: 50, cost: 3, stackable: true, members: false },
        { obj: 'lawrune', name: 'Law rune', baseline: 250, restockTicks: 300, cost: 40, stackable: true, members: false },
        { obj: 'deathrune', name: 'Death rune', baseline: 250, restockTicks: 150, cost: 30, stackable: true, members: false },
        { obj: 'firerune', name: 'Fire rune', baseline: 200, restockTicks: 50, cost: 4, stackable: true, members: false }
    ]
};

const ALL = new Set(REC.items.map(i => i.name.toLowerCase()));

describe('buyoutPlan', () => {
    test('allocates valuable-first (law > death > fire > mind) regardless of record order', () => {
        const plan = buyoutPlan(REC, { mindrune: 10, lawrune: 10, deathrune: 10, firerune: 10 }, 1_000_000, ALL);
        expect(plan.map(p => p.obj)).toEqual(['lawrune', 'deathrune', 'firerune', 'mindrune']);
        expect(plan.every(p => p.units === 10)).toBe(true);
    });

    test('coin budget bounds the plan; cheap tail starves before the valuable head', () => {
        const plan = buyoutPlan(REC, { lawrune: 10, mindrune: 10 }, 1000, ALL);
        const law = plan.find(p => p.obj === 'lawrune')!;
        const mind = plan.find(p => p.obj === 'mindrune')!;
        expect(law.units).toBe(4);
        expect(law.estCost).toBe(960);
        expect(mind.units).toBe(2);
    });

    test('honors the chosen filter and skips empty stock', () => {
        const plan = buyoutPlan(REC, { lawrune: 5, deathrune: 0, firerune: 5 }, 100_000, new Set(['law rune', 'death rune']));
        expect(plan.map(p => p.obj)).toEqual(['lawrune']);
        expect(plan[0].units).toBe(5);
    });

    test('unknown stock names are ignored; zero coins buys nothing', () => {
        expect(buyoutPlan(REC, { not_a_rune: 50 }, 100_000, ALL)).toEqual([]);
        expect(buyoutPlan(REC, { lawrune: 5 }, 0, ALL)).toEqual([]);
    });
});
