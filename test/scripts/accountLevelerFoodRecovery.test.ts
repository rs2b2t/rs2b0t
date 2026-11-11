import { expect, test } from 'bun:test';
import { producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { requirementKey, type LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 50])), fishing: 40, cooking: 40 },
    stock: { coins: 100000, 'lobster pot': 1, 'small fishing net': 1 },
    bankReady: true, quests: {}, target: 50, wilderness: false, now: 1000
});

test('an empty food bank prepares local travel food before fishing and cooking lobsters', () => {
    const s = snapshot();
    const memory = emptyMemory();
    const cook = producer(s, 'prayer', { item: 'Lobster', count: 24 }, memory, () => 0)!;
    const result = resolveActivity(s, cook, memory, () => 0);
    expect(result.kind).toBe('activity');
    if (result.kind !== 'activity') return;
    expect(result.queue.map(plan => [plan.script, plan.settings.location])).toEqual([
        ['Fisher', 'Draynor Village'], ['CookBot', 'Draynor'], ['Fisher', 'Catherby'], ['CookBot', 'Draynor']
    ]);
    expect(result.queue.map(plan => plan.output?.item)).toEqual(['Raw shrimps', 'Shrimps', 'Raw lobster', 'Lobster']);
    const fishing = result.queue[2];
    expect(fishing.needs).toContainEqual({ item: 'Shrimps', count: 12, carry: 12 });
    expect(fishing.needs).toContainEqual({ item: 'Lobster pot', count: 1, carry: 1 });
    expect(fishing.needs).toContainEqual({ item: 'Coins', count: 200, carry: 200 });
    for (const plan of result.queue) {
        expect(resolveActivity(s, plan, memory, () => 0).kind).toBe('activity');
        if (plan.output) s.stock[requirementKey(plan.output).toLowerCase()] = plan.output.count;
    }
    expect(s.stock.lobster).toBe(24);
});

test('banked raw shrimp skip the initial catch when preparing the lobster trip', () => {
    const s = snapshot();
    s.stock['raw shrimps'] = 28;
    const plan = producer(s, 'prayer', { item: 'Raw lobster', count: 28 }, emptyMemory(), () => 0);
    expect(plan).not.toBeNull();
    const result = resolveActivity(s, plan!, emptyMemory(), () => 0);
    expect(result.kind).toBe('activity');
    if (result.kind === 'activity') expect(result.queue.map(plan => plan.script)).toEqual(['CookBot', 'Fisher']);
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
