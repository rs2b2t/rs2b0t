import { expect, test } from 'bun:test';
import { foodFor } from '#/bot/scripts/AccountLeveler/combat.js';
import { crowdKey } from '#/bot/scripts/AccountLeveler/crowding.js';
import { FISHING_LOCATIONS } from '#/bot/data/fishingLocations.js';
import { producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, planNext, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { requirementKey, type LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 50])), fishing: 40, cooking: 40 },
    stock: { coins: 100000, 'lobster pot': 1, 'small fishing net': 1 },
    bankReady: true, quests: {}, target: 50, wilderness: false, now: 1000
});

test.each([
    { fishing: 40, cooking: 40, food: 'Lobster', tool: 'Lobster pot' },
    { fishing: 76, cooking: 80, food: 'Shark', tool: 'Harpoon' },
    { fishing: 76, cooking: 79, food: 'Lobster', tool: 'Lobster pot' }
])('defence resupplies $food directly with an empty food bank and crowded Draynor fishing', ({ fishing, cooking, food, tool }) => {
    const s = snapshot();
    Object.assign(s.levels, { fishing, cooking, defence: 49 });
    s.allowQuests = false;
    const memory = emptyMemory();
    memory.cooldowns[crowdKey(FISHING_LOCATIONS.find(site => site.name === 'Draynor Village')!.spot)] = s.now + 30 * 60000;
    expect(foodFor(s)).toBe(food);
    const result = planNext(s, memory, () => 0);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.queue.map(plan => plan.script)).toEqual(['Fisher', 'CookBot', 'AutoFighter']);
    expect(result.queue.map(plan => plan.output?.item ?? plan.food)).toEqual(['Raw ' + food.toLowerCase(), food, food]);
    expect(result.plan.settings.location).toBe('Catherby');
    expect(result.plan.needs).toContainEqual({ item: tool, count: 1, carry: 1 });
    expect(result.plan.needs).toContainEqual({ item: 'Coins', count: 200, carry: 200 });
    for (const plan of result.queue) {
        expect(resolveActivity(s, plan, memory, () => 0)).toMatchObject({ kind: 'activity', plan: { id: plan.id } });
        if (plan.output) s.stock[requirementKey(plan.output).toLowerCase()] = plan.output.count;
    }
    expect(s.stock[food.toLowerCase()]).toBe(24);
});

test('banked raw lobsters can supply defence without a fishing trip', () => {
    const s = snapshot();
    s.levels.fishing = 1;
    s.stock['raw lobster'] = 28;
    expect(foodFor(s)).toBe('Lobster');
    const cook = producer(s, 'defence', { item: 'Lobster', count: 24 }, emptyMemory(), () => 0)!;
    expect(resolveActivity(s, cook, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'CookBot' }, queue: [cook] });
});

test('existing travel food is reused and fishing level requirements still apply', () => {
    const s = snapshot();
    s.stock.trout = 12;
    const plan = producer(s, 'prayer', { item: 'Raw lobster', count: 28 }, emptyMemory(), () => 0)!;
    expect(plan.food).toBe('Trout');
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('activity');
    s.levels.fishing = 39;
    expect(producer(s, 'prayer', { item: 'Raw lobster', count: 28 }, emptyMemory(), () => 0)).toBeNull();
});

test.each(['coins', 'combat'])('local food preparation does not bypass the %s travel requirement', missing => {
    const s = snapshot();
    if (missing === 'coins') s.stock.coins = 199;
    else s.levels.hitpoints = 10;
    expect(producer(s, 'prayer', { item: 'Raw lobster', count: 28 }, emptyMemory(), () => 0)).toBeNull();
});

test.each([
    { fishing: 40, draw: 0.99, expected: 'Catherby' },
    { fishing: 67, draw: 0.99, expected: 'Catherby' },
    { fishing: 68, draw: 0.99, expected: 'Fishing Guild' }
])('resolves lobster fishing at $expected with both piers marked crowded at Fishing $fishing', ({ fishing, draw, expected }) => {
    const s = snapshot();
    s.levels.fishing = fishing;
    const memory = emptyMemory();
    for (const name of ['Catherby', 'Fishing Guild']) {
        const site = FISHING_LOCATIONS.find(site => site.name === name)!;
        memory.cooldowns[crowdKey(site.spot)] = s.now + 30 * 60000;
    }
    const cook = producer(s, 'defence', { item: 'Lobster', count: 24 }, memory, () => 0)!;
    const result = resolveActivity(s, cook, memory, () => draw);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.queue.map(plan => plan.script)).toEqual(['Fisher', 'CookBot']);
    expect(result.plan.settings).toMatchObject({ location: expected, fishMethod: 'Lobster cage — lobster', withdrawCoins: 0 });
    expect(result.plan.output).toEqual({ item: 'Raw lobster', count: 28 });
});

test('sharks can move to the Fishing Guild but cannot use the lobster pier at Musa Point', () => {
    const s = snapshot();
    s.levels.fishing = 76;
    const memory = emptyMemory();
    const need = { item: 'Raw shark', count: 28 };
    memory.cooldowns[crowdKey(FISHING_LOCATIONS.find(site => site.name === 'Catherby')!.spot)] = s.now + 30 * 60000;
    expect(producer(s, 'defence', need, memory, () => 0)?.settings.location).toBe('Catherby');
    memory.cooldowns[crowdKey(FISHING_LOCATIONS.find(site => site.name === 'Fishing Guild')!.spot)] = s.now + 30 * 60000;
    expect(producer(s, 'defence', need, memory, () => 0.99)?.settings.location).toBe('Fishing Guild');
});
