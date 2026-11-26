import { expect, test } from 'bun:test';
import { runeReserveOrder, RUNE_TARGETS } from '#/bot/scripts/AccountLeveler/runes.js';
import { supplyOffer, purchaseBudget } from '#/bot/scripts/AccountLeveler/offers.js';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { trainingArea } from '#/bot/scripts/AccountLeveler/crowding.js';
import { emptyMemory } from '#/bot/scripts/AccountLeveler/planner.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const state = (stock: Record<string, number>): LevelerSnapshot => ({
    stock, bankReady: true, now: 100, levels: { runecraft: 55 }, quests: { 'Rune Mysteries Quest': true },
    target: 70, wilderness: false, allowQuests: false
});
const plan: ActivityPlan = { id: 'quest', label: 'Quest', objective: 'attack', script: 'AIOQuester', settings: {},
    needs: [{ item: 'Coins', count: 15_000 }, { item: 'Bronze arrow', count: 100 }] };

test('reserve purchases cover part of an elemental deficit and leave quest and supply money in the bank', () => {
    const snapshot = state({ coins: 35_000, 'air rune': 300 });
    const order = runeReserveOrder(snapshot, [plan], {})!;
    expect(order.needs.map(need => need.item).sort()).toEqual(['Air rune', 'Earth rune', 'Fire rune', 'Water rune']);
    const actualBudget = order.needs.reduce((sum, need) => sum + purchaseBudget(supplyOffer(need.item)!, need.count - (snapshot.stock[need.item.toLowerCase()] ?? 0)), 0);
    expect(actualBudget).toBe(order.budget);
    expect(order.budget).toBeLessThanOrEqual(35_000 - 15_000 - purchaseBudget(supplyOffer('Bronze arrow')!, 100));
    expect(order.needs.every(need => need.count <= RUNE_TARGETS[need.item])).toBe(true);
    expect(runeReserveOrder(state({ coins: 15_000 }), [plan], {})).toBeNull();
    expect(runeReserveOrder(snapshot, [plan], { 'rune-reserves': 200 })).toBeNull();
});

test('full stacks, an unloaded bank and sold-out elemental shops skip reserve trips', () => {
    const full = Object.fromEntries(Object.entries(RUNE_TARGETS).map(([name, count]) => [name.toLowerCase(), count]));
    expect(runeReserveOrder(state({ ...full, coins: 1_000_000 }), [], {})).toBeNull();
    expect(runeReserveOrder({ ...state({ coins: 1_000_000 }), bankReady: false }, [], {})).toBeNull();
    expect(runeReserveOrder({ ...state({ coins: 1_000_000 }), unavailableItems: Object.keys(full) }, [], {})).toBeNull();
});

test('market-only rune purchases reserve the rest of the bank and respect the market lot', () => {
    const snapshot = state({ coins: 1_000_000 });
    snapshot.marketItem = need => need.item === 'Law rune' ? 563 : undefined;
    const order = runeReserveOrder(snapshot, [], {})!;
    expect(order.market).toEqual({ item: 'Law rune', id: 563, count: 1000 });
    expect(order.reserve).toBe(snapshot.stock.coins - order.budget);
    expect(order.reserve).toBeGreaterThan(500_000);
    snapshot.stock.coins = 1000;
    expect(runeReserveOrder(snapshot, [], {})?.market).toBeUndefined();
});

test('crafts whichever reserve still needs runes, including Fire and Water using solo routes', () => {
    const full = Object.fromEntries(Object.entries(RUNE_TARGETS).map(([name, count]) => [name.toLowerCase(), count]));
    for (const [rune, bank] of [['Fire', { x: 3269, z: 3167 }], ['Water', { x: 3093, z: 3243 }]] as const) {
        const snapshot = state({ ...full, [rune.toLowerCase() + ' rune']: 10, [rune.toLowerCase() + ' talisman']: 1, 'law talisman': 1 });
        const plan = methodFor(snapshot, 'runecraft', emptyMemory(), () => 0)!;
        expect(plan).toMatchObject({ script: 'RuneCrafter', settings: { rune: rune + ' runes' }, travel: bank });
        expect(trainingArea(plan)?.spot.x).toBe((rune === 'Fire' ? 40 : 42) * 64 + 32);
        expect(producer(snapshot, 'magic', { item: rune + ' rune', count: 100 }, emptyMemory(), () => 0)).toMatchObject({ script: 'RuneCrafter', output: { count: 100 } });
    }
});
