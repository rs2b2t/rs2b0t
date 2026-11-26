import { expect, test } from 'bun:test';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, planNext, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { nextMilestone } from '#/bot/scripts/AccountLeveler/catalog.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import '#/bot/scripts/index.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 60])),
    stock: { coins: 1000000, lobster: 100, 'air talisman': 1, 'fire talisman': 1, 'rune pickaxe': 1, 'rune axe': 1,
        'fly fishing rod': 1, feather: 200, knife: 1, logs: 100, 'maple logs': 100, 'yew logs': 100,
        'raw swordfish': 100, 'hard leather': 100, 'steel bar': 100, 'dragon bones': 100,
        kwuarm: 100, 'limpwurt root': 100, 'vial of water': 100 },
    quests: { 'Druidic Ritual': true, 'Rune Mysteries Quest': true, 'Dragon Slayer': true, 'Lost City': true },
    bankReady: true, target: 70, wilderness: true, now: 1000
});
const planFor = (s: LevelerSnapshot, skill: string) => methodFor(s, skill, emptyMemory(), () => 0)!;

test.each(enabledSkills)('%s remains trainable through 69 and completes at 70', skill => {
    const s = snapshot();
    s.levels = Object.fromEntries(enabledSkills.map(name => [name, name === skill ? 69 : 70]));
    const decision = planNext(s, emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind === 'activity') expect(decision.plan.objective).toBe(skill);
    s.levels[skill] = 70;
    expect(planNext(s, emptyMemory()).kind).toBe('complete');
});

const methodCases: [string, string, Record<string, unknown>][] = [
    ['fishing', 'Fisher', { bank: true, fishMethod: 'Lobster cage — lobster' }],
    ['mining', 'Miner', { bank: true, rocks: ['Iron'], tickManip: 'Off' }],
    ['woodcutting', 'Woodcutter', { bank: true, treeName: 'Willow' }],
    ['fletching', 'BankFletcher', { material: 'Maple logs', product: 'Long bow' }],
    ['firemaking', 'Firemaker', { logType: 'Yew logs' }],
    ['cooking', 'CookBot', { fish: 'Raw swordfish' }],
    ['crafting', 'LeatherCrafter', { leatherType: 'Hard leather' }],
    ['smithing', 'SmithingBot', { bar: 'Steel', product: 'Platebody' }],
    ['herblore', 'PotionMaker', { herb: 'Kwuarm', secondary: 'Limpwurt root' }],
    ['prayer', 'BoneBurier', { boneName: 'Dragon bones' }],
    ['thieving', 'Thiever', { target: 'Warrior woman' }],
    ['agility', 'EdgevilleMonkeyBars', {}],
    ['runecraft', 'JiveRC', { rune: 'Law runes', mode: 'Solo' }]
];

test.each(methodCases)('60+ %s selects an executable training method', (skill, script, settings) => {
    const s = snapshot();
    const plan = planFor(s, String(skill));
    expect(plan.script).toBe(String(script));
    expect(plan.settings).toMatchObject(settings as object);
    const schema = ScriptRegistry.get(plan.script)?.settingsSchema;
    expect(schema).toBeDefined();
    for (const [name, value] of Object.entries(plan.settings)) {
        if (schema?.[name]?.options?.length && typeof value === 'string') expect(schema[name].options).toContain(value);
    }
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('activity');
});

test('level 60 melee rotates among eligible NPCs and keeps burying big bones', () => {
    const targets = new Set();
    for (const roll of [0, 0.25, 0.5, 0.75, 0.99]) {
        const plan = methodFor(snapshot(), 'attack', emptyMemory(), () => roll)!;
        expect(plan.settings.buryBigBones).toBe(true);
        targets.add(plan.settings.target);
    }
    expect(targets.size).toBeGreaterThan(1);
});

test('green bodies unlock at 63 and consume the available tanned leather', () => {
    const s = snapshot(); s.stock['green dragon leather'] = 100;
    expect(planFor(s, 'crafting').settings.leatherType).toBe('Hard leather');
    s.levels.crafting = 63;
    expect(planFor(s, 'crafting').settings.leatherType).toBe('Green dragon leather');
});

test('stocked gold and gauntlets do not replace steel platebodies', () => {
    const s = snapshot(); s.stock['gold ore'] = 100; s.stock['goldsmith gauntlet'] = 1;
    const plan = planFor(s, 'smithing');
    expect(plan.settings).toMatchObject({ bar: 'Steel', product: 'Platebody' });
    expect(plan.needs).toContainEqual({ item: 'Steel bar', count: 25, minimum: 5 });
    delete s.stock['hard leather'];
    expect(planFor(s, 'crafting').script).toBe('FlaxAIO');
});

test('gathering dependencies bank the requested resource', () => {
    const s = snapshot();
    for (const item of ['Maple logs', 'Yew logs', 'Iron ore', 'Coal', 'Raw lobster']) {
        const plan = producer(s, 'fletching', { item, count: 100 }, emptyMemory(), () => 0)!;
        expect(plan).not.toBeNull();
        expect(plan.settings.bank).toBe(true);
        expect(plan.output).toEqual({ item, count: item === 'Raw lobster' ? 100 : 1000 });
    }
});

test('60+ recipe milestones replan before the target', () => {
    const s = snapshot();
    expect(nextMilestone(s, 'crafting')).toBe(63);
    expect(nextMilestone(s, 'herblore')).toBe(66);
    s.levels.herblore = 66;
    expect(nextMilestone(s, 'herblore')).toBe(69);
});

test('stocked super potions boost melee without adding missing potion purchases', () => {
    const s = snapshot(); s.stock['super attack(3)'] = 3; s.stock['super strength(2)'] = 1;
    const plan = planFor(s, 'strength');
    expect(plan.settings).toMatchObject({ useSuperAttack: true, useSuperStrength: true, buryBones: false });
    expect(plan.settings.useSuperDefence).not.toBe(true);
    expect(plan.needs).toContainEqual({ item: 'Super attack(3)', count: 1, carry: 1 });
});

test('banked blast runes unlock Fire Blast', () => {
    const s = snapshot();
    s.stock['death rune'] = 200; s.stock['fire rune'] = 1000; s.stock['staff of air'] = 1;
    expect(planFor(s, 'magic').settings.spell).toBe('Fire Blast');
});

test('hard clue potion ingredients and shop-entry diamond have actual producer chains', () => {
    const s = snapshot();
    for (const item of ['Superantipoison(3)', 'Irit leaf', '#209', 'Unicorn horn', 'Unicorn horn dust', 'Diamond', 'Uncut diamond']) {
        const plan = producer(s, 'hard-clues', { item, count: 1 }, emptyMemory(), () => 0);
        expect(plan).not.toBeNull();
        expect(plan?.output).toEqual({ item, count: 1 });
        if (plan) {
            const result = resolveActivity(s, plan, emptyMemory(), () => 0);
            if (result.kind !== 'activity') throw new Error(`${item}: ${JSON.stringify(result)}`);
        }
    }
});


test('steel platebodies resolve through banked iron, coal and steel bars', () => {
    const s = snapshot();
    delete s.stock['steel bar'];
    const plan = planFor(s, 'smithing');
    const next = () => {
        const decision = resolveActivity(s, plan, emptyMemory(), () => 0);
        if (decision.kind !== 'activity') throw new Error(JSON.stringify(decision));
        return decision;
    };
    expect(next().plan.settings).toMatchObject({ rocks: ['Iron'], bank: true });
    s.stock['iron ore'] = 9;
    expect(next().plan.settings).toMatchObject({ rocks: ['Coal'], bank: true, location: 'Mining Guild' });
    s.stock.coal = 18;
    expect(next().plan).toMatchObject({ script: 'SmelterBot', settings: { bar: 'Steel' }, output: { item: 'Steel bar', count: 25 } });
    s.stock['steel bar'] = 25;
    expect(next().plan).toBe(plan);
});

test.each([30, 59, 60])('coal supplies at Mining %i use an accessible coal mine', level => {
    const s = snapshot(); s.levels.mining = level;
    const plan = producer(s, 'smithing', { item: 'Coal', count: 18 }, emptyMemory(), () => 0)!;
    expect(plan?.settings).toMatchObject({ rocks: ['Coal'], bank: true, location: level >= 60 ? 'Mining Guild' : 'Barbarian Village' });
});

test('coal gathering and steel smelting enforce their level requirements', () => {
    const s = snapshot(); s.levels.mining = 29;
    expect(producer(s, 'smithing', { item: 'Coal', count: 18 }, emptyMemory(), () => 0)).toBeNull();
    s.levels.smithing = 29;
    expect(producer(s, 'smithing', { item: 'Steel bar', count: 25 }, emptyMemory(), () => 0)).toBeNull();
});

test('stocked High Alchemy takes priority over combat at 55 Magic', () => {
    const s = snapshot();
    Object.assign(s.stock, { '#851': 27, 'maple longbow': 27, 'nature rune': 27, 'staff of fire': 1 });
    s.levels.magic = 54;
    expect(planFor(s, 'magic').script).toBe('AutoFighter');
    s.levels.magic = 55;
    expect(methodFor(s, 'magic', emptyMemory(), () => 0)?.script).toBe('Alcher');
    expect(methodFor(s, 'magic', emptyMemory(), () => 0.9)?.script).toBe('Alcher');
});
