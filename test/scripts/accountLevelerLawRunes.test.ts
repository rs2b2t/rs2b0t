import { expect, test } from 'bun:test';
import '#/bot/scripts/index.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 54])),
    stock: { 'law talisman': 1, 'air talisman': 1, 'rune essence': 1000, 'rune pickaxe': 1 },
    quests: { 'Rune Mysteries Quest': true }, bankReady: true, target: 70, wilderness: false, now: 1000
});
const planFor = (s: LevelerSnapshot) => methodFor(s, 'runecraft', emptyMemory(), () => 0)!;

test('Law crafting at 54 delegates an executable solo plan', () => {
    const s = snapshot();
    const plan = planFor(s);
    expect(plan).toMatchObject({ script: 'JiveRC', settings: { rune: 'Law runes', mode: 'Solo' }, travel: { x: 3093, z: 3243, level: 0 } });
    expect(plan.needs).toEqual([{ item: 'Law talisman', count: 1, carry: 1 }, { item: 'Rune essence', count: 27 }]);
    const schema = ScriptRegistry.get(plan.script)!.settingsSchema!;
    for (const [key, value] of Object.entries(plan.settings)) {
        if (typeof value !== 'string') throw new Error(`Unexpected ${key} setting type`);
        expect(schema[key].options).toContain(value);
    }
    expect(resolveActivity(s, plan, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'JiveRC' } });
});

test('Air crafting stops at 54 so the next selection can switch to Law', () => {
    const s = snapshot(); s.levels.runecraft = 53;
    expect(planFor(s)).toMatchObject({ settings: { rune: 'Air runes' }, prerequisiteLevels: { runecraft: 54 } });
    s.levels.runecraft = 54;
    expect(planFor(s).settings.rune).toBe('Law runes');
});

test('quest-disabled accounts can still craft Air with no higher talisman', () => {
    const s = snapshot(); delete s.stock['law talisman']; s.levels.runecraft = 80; s.allowQuests = false;
    expect(planFor(s).settings.rune).toBe('Air runes');
});

test('Rune Mysteries remains the runecrafting prerequisite', () => {
    const s = snapshot(); s.quests = {};
    expect(planFor(s)).toMatchObject({ script: 'AIOQuester', quest: 'Rune Mysteries Quest' });
    s.allowQuests = false;
    expect(planFor(s)).toBeNull();
});

test('Law supplies resolve through essence mining without consuming Law runes', () => {
    const s = snapshot(); delete s.stock['rune essence'];
    const plan = producer(s, 'prayer', { item: 'Law rune', count: 20 }, emptyMemory(), () => 0)!;
    expect(plan).toMatchObject({ script: 'JiveRC', objective: 'prayer', output: { item: 'Law rune', count: 20 } });
    expect(plan.needs.some(need => need.item === 'Law rune')).toBe(false);
    expect(resolveActivity(s, plan, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'EssMiner' } });
    s.stock['rune essence'] = 1000;
    expect(resolveActivity(s, plan, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'JiveRC' } });
});

test.each(['level', 'talisman', 'quest'])('Law supplies are unavailable without the %s prerequisite', missing => {
    const s = snapshot();
    if (missing === 'level') s.levels.runecraft = 53;
    if (missing === 'talisman') { delete s.stock['law talisman']; s.allowQuests = false; }
    if (missing === 'quest') s.quests = {};
    expect(producer(s, 'prayer', { item: 'Law rune', count: 20 }, emptyMemory(), () => 0)).toBeNull();
});

test('Nature training buys its talisman at Seers and uses the solo Ardougne route', () => {
    const s = snapshot();
    s.stock.coins = 10000;
    s.levels.runecraft = 44;
    s.marketItem = need => need.item === 'Nature talisman' ? 1462 : undefined;
    const nature = planFor(s);
    expect(nature).toMatchObject({ script: 'JiveRC', settings: { mode: 'Solo', rune: 'Nature runes' }, travel: { x: 2655, z: 3283 } });
    expect(resolveActivity(s, nature, emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'SeersMarket', output: { item: 'Nature talisman', count: 1 } } });
    s.marketItem = undefined;
    expect(planFor(s).settings.rune).toBe('Air runes');
    s.stock['nature talisman'] = 1;
    expect(producer(s, 'magic', { item: 'Nature rune', count: 200 }, emptyMemory(), () => 0)).toMatchObject({ script: 'JiveRC', output: { item: 'Nature rune', count: 200 } });
});

test('Law unlock goes through Death Plateau, Troll Stronghold and Dunstan', () => {
    const s = snapshot();
    delete s.stock['law talisman'];
    s.stock.coins = 100000;
    s.stock.lobster = s.stock.shark = 80;
    s.marketItem = () => 1458;
    const next = () => resolveActivity(s, planFor(s), emptyMemory(), () => 0);
    expect(next()).toMatchObject({ kind: 'activity', plan: { quest: 'Death Plateau' } });
    s.quests['Death Plateau'] = true;
    expect(next()).toMatchObject({ kind: 'activity', plan: { quest: 'Troll Stronghold' } });
    s.quests['Troll Stronghold'] = true;
    expect(next()).toMatchObject({ kind: 'activity', plan: { output: { item: 'Law talisman' }, travel: { x: 2919, z: 3574 } } });
});

test('Earth and Cosmic use their own banks, and Cosmic needs a way home', () => {
    const s = snapshot();
    s.levels.runecraft = 27;
    s.stock['earth talisman'] = s.stock['cosmic talisman'] = 1;
    expect(planFor(s)).toMatchObject({ settings: { rune: 'Earth runes' }, travel: { x: 3253, z: 3420 } });
    s.stock['earth rune'] = 1000; s.stock['air rune'] = 10000;
    s.quests['Lost City'] = true;
    s.stock['dramen staff'] = s.stock.diamond = 1;
    expect(planFor(s)).toMatchObject({ script: 'JiveRC', settings: { rune: 'Cosmic runes' }, travel: { x: 3152, z: 9575 } });
    expect(planFor(s).needs.some(need => need.item === 'Dramen staff' && need.carry === 1)).toBe(true);
    delete s.stock.diamond;
    expect(planFor(s).settings.rune).toBe('Earth runes');
});

test('Law unlock can train Agility for Troll Stronghold', () => {
    const s = snapshot();
    delete s.stock['law talisman'];
    s.quests['Death Plateau'] = true;
    s.levels.agility = 12;
    const prep = producer(s, 'runecraft', { item: 'Law talisman', count: 1 }, emptyMemory(), () => 0);
    expect(prep).toMatchObject({ script: 'GnomeCourse', prerequisiteLevels: { agility: 15 } });
});
