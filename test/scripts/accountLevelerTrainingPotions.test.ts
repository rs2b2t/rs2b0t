import { expect, test } from 'bun:test';
import { refreshConsumables } from '#/bot/scripts/AccountLeveler/catalog.js';
import { supplyOffers } from '#/bot/scripts/AccountLeveler/offers.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(herblore: number, stock: Record<string, number> = {}): LevelerSnapshot {
    return {
        levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 70])), attack: 60, herblore },
        stock: { coins: 500000, lobster: 100, ...stock }, quests: { 'Druidic Ritual': true, 'Dragon Slayer': true, 'Lost City': true },
        target: 70, bankReady: true, wilderness: false, now: 1000
    };
}

function next(s: LevelerSnapshot) {
    const result = planNext(s, emptyMemory(), () => 0);
    if (result.kind !== 'activity') throw Error(result.kind);
    return result;
}

test('a melee training objective gathers the missing irit by ID and queues cleaning and brewing', () => {
    const result = next(snapshot(45, { 'irit leaf': 20, '#209': 8 }));
    expect(result.plan.settings.target).toBe('Chaos druid');
    expect(result.plan.output).toEqual({ item: '#209', count: 80 });
    expect(result.queue.map(p => p.script)).toEqual(['AutoFighter', 'HerbCleaner', 'PotionMaker']);
    expect(result.queue.at(-1)?.needs).toEqual(expect.arrayContaining([
        { item: 'Eye of newt', count: 100 }, { item: 'Vial of water', count: 100 }
    ]));
});

test('finishes banked kwuarm unfinished potions and gathers only the missing roots', () => {
    const result = next(snapshot(55, { 'super attack(4)': 75, '#105': 95, kwuarm: 5, 'limpwurt root': 30 }));
    expect(result.plan.settings.target).toBe('Hobgoblin');
    expect(result.plan.output).toEqual({ item: 'Limpwurt root', count: 100 });
    expect(result.queue.at(-1)?.needs).toContainEqual({ item: 'Vial of water', count: 5 });
});

test('counts finished doses toward the batch and skips herbs and vials for unfinished stock', () => {
    const plan = next(snapshot(45, { 'super attack(4)': 3, '#101': 96 })).plan;
    expect(plan.script).toBe('PotionMaker');
    expect(plan.settings).toMatchObject({ herb: 'Irit leaf', secondary: 'Eye of newt', outputId: 145, outputCount: 96 });
    expect(plan.needs).toEqual([{ item: 'Eye of newt', count: 96 }]);
});

test('regular melee training carries existing boosts, including four-dose and partial bottles', () => {
    const plan = next(snapshot(55, { 'super attack(4)': 10, 'super strength(1)': 36 })).plan;
    expect(plan.script).toBe('AutoFighter');
    expect(plan.settings).toMatchObject({ useSuperAttack: true, useSuperStrength: true });
    expect(plan.needs).toContainEqual({ item: 'Super attack(4)', count: 1, carry: 1 });
    expect(plan.needs).toContainEqual({ item: 'Super strength(1)', count: 1, carry: 1 });
});

test('continues training when brewing is locked or the ingredient supplier is unavailable', () => {
    for (const s of [snapshot(44), { ...snapshot(55), quests: { 'Dragon Slayer': true, 'Lost City': true } },
        { ...snapshot(45, { 'irit leaf': 100 }), unavailableItems: ['eye of newt'] }]) {
        expect(next(s).plan.output).toBeUndefined();
    }
});

test('a stocked account can fill its own empty vials without purchasing them', () => {
    const s = snapshot(45, { coins: 0, vial: 100, 'irit leaf': 100, 'eye of newt': 100 });
    expect(next(s).plan.settings.outputId).toBe(145);
});

test('resuming a partially made batch only requests the remaining ingredients', () => {
    const original = next(snapshot(45, { 'irit leaf': 100 })).plan;
    const resumed = snapshot(45, { 'super attack(3)': 50, '#101': 15, 'irit leaf': 35, 'vial of water': 35, 'eye of newt': 50 });
    const refreshed = refreshConsumables(resumed, original);
    expect(refreshed.needs).toEqual([{ item: 'Vial of water', count: 35 }, { item: 'Eye of newt', count: 50 }, { item: 'Irit leaf', count: 35 }]);
    expect(next(resumed).plan).toEqual(refreshed);
    const cleaning = next(snapshot(45)).queue.find(plan => plan.script === 'HerbCleaner')!;
    expect(refreshConsumables(resumed, cleaning).needs).toEqual([{ item: '#209', count: 65 }]);
});

test('stocks both recipes across bank visits and returns to combat after the second batch', () => {
    const s = snapshot(55, { 'irit leaf': 100, kwuarm: 100, 'vial of water': 200, 'limpwurt root': 100, 'eye of newt': 100 });
    for (const [herb, secondary, potion] of [
        ['Irit leaf', 'Eye of newt', 'Super attack(3)'], ['Kwuarm', 'Limpwurt root', 'Super strength(3)']
    ]) {
        const plan = next(s).plan;
        expect(plan.output).toEqual({ item: potion, count: 100 });
        expect(plan.settings).toMatchObject({ herb, secondary });
        for (const need of plan.needs) s.stock[need.item.toLowerCase()] -= need.count;
        s.stock[potion.toLowerCase()] = 100;
    }
    expect(s.stock['vial of water']).toBe(0);
    expect(next(s).plan).toMatchObject({ script: 'AutoFighter', settings: { useSuperAttack: true, useSuperStrength: true } });
    expect(supplyOffers('Eye of newt').map(offer => offer.keeper)).toEqual(['Betty', 'Jatix']);
});
