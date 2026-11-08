import { expect, test } from 'bun:test';
import '#/bot/scripts/index.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(levels: Record<string, number> = {}): LevelerSnapshot {
    return { levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 40])), ...levels }, stock: { coins: 500000, shrimps: 30 },
        bankReady: true, quests: {}, target: 50, wilderness: false, now: 1000 };
}
const method = (s: LevelerSnapshot, skill: string, recent: string[] = [], random = 0) => methodFor(s, skill, { ...emptyMemory(), recent }, () => random)!;

function transit(plan: ActivityPlan) {
    expect(plan.food).toBe('Shrimps');
    expect(plan.needs.find(need => need.item === 'Shrimps')?.carry).toBe(12);
    expect(plan.needs.find(need => need.item === 'Coins')).toMatchObject({ count: 200, carry: 200 });
    expect(plan.travel?.x).toBeLessThan(2900);
}

test.each([{ woodcutting: 1, location: 'Seers (trees)' }, { woodcutting: 15, location: 'Seers Oaks' }, { woodcutting: 30, location: 'Seers Willows' }])('woodcutting $woodcutting uses its matching Seers camp with travel supplies', ({ woodcutting, location }) => {
    const plan = method(snapshot({ woodcutting }), 'woodcutting');
    expect(plan.settings.location).toBe(location);
    expect(plan.needs.some(need => need.item === 'Steel axe')).toBe(true);
    transit(plan);
});

test('fishing selects member methods at their real levels without using unsupported Catherby shrimp spots', () => {
    expect(method(snapshot({ fishing: 1 }), 'fishing').settings.location).toBe('Draynor Village');
    const fly = method(snapshot({ fishing: 20 }), 'fishing');
    expect(fly.settings).toMatchObject({ location: 'Seers (fly fishing)', fishMethod: 'Fly fishing — trout/salmon' });
    transit(fly);
    const lobster = method(snapshot({ fishing: 40 }), 'fishing');
    expect(lobster.settings).toMatchObject({ location: 'Catherby', fishMethod: 'Lobster cage — lobster' });
    expect(lobster.needs).toContainEqual({ item: 'Lobster pot', count: 1, carry: 1 });
    transit(lobster);
});

test('mining keeps copper and tin below 30, then uses the verified Fight Arena iron mine and Yanille bank', () => {
    const s = snapshot({ mining: 29 });
    expect(method(s, 'mining').settings).toMatchObject({ rocks: ['Copper'], location: 'Southeast Varrock Mine' });
    s.stock['copper ore'] = 14;
    expect(method(s, 'mining').settings.rocks).toEqual(['Tin']);
    s.levels.mining = 30;
    const iron = method(s, 'mining');
    expect(iron.settings).toMatchObject({ rocks: ['Iron'], location: 'Fight Arena Mine' });
    expect(iron.travel).toMatchObject({ x: 2612, z: 3092, level: 0 });
    transit(iron);
});

test('cooking rotates between supported member ranges and avoids its recent camp', () => {
    const s = snapshot();
    const first = method(s, 'cooking');
    expect(first.settings.location).toBe('Catherby');
    const second = method(s, 'cooking', [first.id]);
    expect(second.settings.location).toBe('Seers');
    expect(second.id).not.toBe(first.id);
    expect(method(s, 'cooking', [], 0.99).settings.location).toBe('Draynor');
    transit(first);
    transit(second);
});

test('firemaking and smelting use supported Seers and Ardougne facilities', () => {
    const burn = method(snapshot(), 'firemaking');
    expect(burn.settings.location).toBe('Seers');
    transit(burn);
    const smelt = method(snapshot(), 'smithing');
    expect(smelt.script).toBe('SmelterBot');
    expect(smelt.settings).toMatchObject({ bar: 'Iron', bankStand: { x: 2655, z: 3283, level: 0 }, furnaceStand: { x: 2600, z: 3310, level: 0 } });
    transit(smelt);
});

test('member thieving advances to verified Ardougne warrior women at 25', () => {
    expect(method(snapshot({ thieving: 24 }), 'thieving').settings.target).toBe('Farmer');
    const plan = method(snapshot({ thieving: 25 }), 'thieving');
    expect(plan.settings).toMatchObject({ target: 'Warrior woman', action: 'Pickpocket', banking: 'Auto' });
    expect(plan.travel).toMatchObject({ x: 2629, z: 3295, level: 0 });
    transit(plan);
});

test('western sessions require owned food, fare coins, and combat readiness', () => {
    for (const change of ['food', 'coins', 'combat'] as const) {
        const s = snapshot({ fishing: 20 });
        if (change === 'food') s.stock.shrimps = 0;
        if (change === 'coins') s.stock.coins = 199;
        if (change === 'combat') s.levels.hitpoints = 10;
        for (const skill of ['woodcutting', 'mining', 'fishing', 'cooking', 'firemaking', 'smithing', 'thieving']) {
            const plan = method(s, skill);
            expect(plan.travel?.x ?? 3200).toBeGreaterThan(2900);
            expect(['Seers', 'Seers Willows', 'Seers (fly fishing)', 'Catherby', 'Fight Arena Mine']).not.toContain(plan.settings.location);
        }
    }
});

test('initial food production stays local without requiring its own food output', () => {
    const s = snapshot({ attack: 1, strength: 1, defence: 1, hitpoints: 10, fishing: 1, cooking: 1 });
    s.stock.shrimps = 0;
    const plan = producer(s, 'attack', { item: 'Shrimps', count: 24 }, emptyMemory(), () => 0)!;
    expect(plan.settings.location).toBe('Draynor');
    expect(plan.needs.some(need => need.item === 'Shrimps')).toBe(false);
    expect(plan.output).toEqual({ item: 'Shrimps', count: 24 });
});

test('a cooled down member site rotates before resolution rather than blocking another valid site', () => {
    const s = snapshot();
    const first = method(s, 'cooking');
    const next = methodFor(s, 'cooking', { ...emptyMemory(), cooldowns: { [first.id]: s.now + 10000 } }, () => 0)!;
    expect(next.settings.location).toBe('Seers');
});

test('every selected members plan uses installed script settings and preserves requested dependency materials', () => {
    const s = snapshot();
    const plans = ['woodcutting', 'mining', 'fishing', 'cooking', 'firemaking', 'smithing', 'thieving'].map(skill => method(s, skill));
    for (const plan of plans) {
        const schema = ScriptRegistry.get(plan.script)?.settingsSchema;
        expect(schema).toBeDefined();
        for (const [key, value] of Object.entries(plan.settings)) {
            expect(schema?.[key], `${plan.script}.${key}`).toBeDefined();
            if (schema?.[key].options?.length && !schema[key].optionsFrom) {
                for (const chosen of Array.isArray(value) ? value : [value]) expect(schema[key].options).toContain(chosen);
            }
        }
    }
    const logs = producer(s, 'firemaking', { item: 'Logs', count: 28 }, emptyMemory(), () => 0)!;
    expect(logs.settings).toMatchObject({ treeName: 'Tree', location: 'Seers (trees)' });
    expect(logs.output).toEqual({ item: 'Logs', count: 28 });
});

test('existing members-only agility and flax plans prepare food and boat fares before explicit travel', () => {
    for (const skill of ['agility', 'crafting']) {
        const s = snapshot();
        s.stock.shrimps = 0;
        const plan = method(s, skill);
        expect(plan.travel?.x).toBeLessThan(2800);
        expect(plan.needs.find(need => need.item === 'Coins')).toMatchObject({ count: 200, carry: 200 });
        expect(plan.needs.find(need => need.item === plan.food)?.carry).toBe(12);
    }
});

test('an eastbound fallback also carries available food and fares for the return around White Wolf Mountain', () => {
    const plan = method(snapshot(), 'cooking', [], 0.99);
    expect(plan.settings.location).toBe('Draynor');
    expect(plan.travel).toMatchObject({ x: 3093, z: 3243, level: 0 });
    expect(plan.needs.find(need => need.item === 'Coins')).toMatchObject({ count: 200, carry: 200 });
    expect(plan.needs.find(need => need.item === 'Shrimps')).toMatchObject({ count: 12, carry: 12 });
});

test('fixed-site crafting, quest, and ore adapters enter through their actual east-side bank with fares', () => {
    const s = snapshot();
    s.stock['iron bar'] = 28;
    s.quests['Rune Mysteries Quest'] = true;
    const smith = method(s, 'smithing');
    const runes = method(s, 'runecraft');
    const leather = producer(s, 'crafting', { item: 'Leather', count: 26 }, emptyMemory(), () => 0)!;
    const essence = producer(s, 'runecraft', { item: 'Rune essence', count: 27 }, emptyMemory(), () => 0)!;
    s.quests['Rune Mysteries Quest'] = false;
    const quest = method(s, 'runecraft');
    for (const [plan, x, z] of [[smith, 3185, 3440], [runes, 3013, 3355], [leather, 3269, 3167], [essence, 3251, 3420], [quest, 3253, 3420]] as const) {
        expect(plan.travel).toMatchObject({ x, z, level: 0 });
        expect(plan.needs.find(need => need.item === 'Coins')?.carry).toBeGreaterThanOrEqual(200);
    }
    expect(quest.needs.find(need => need.item === 'Coins')?.count).toBe(2000);
    expect(quest.needs.find(need => need.item === quest.food)?.count).toBe(24);
});
