import { expect, test } from 'bun:test';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (level = 40): LevelerSnapshot => ({ levels: Object.fromEntries(enabledSkills.map(s => [s, level])), stock: { coins: 100000 }, bankReady: true, quests: { 'Druidic Ritual': true, 'Rune Mysteries Quest': true }, target: 40, wilderness: true, now: 1 });
const method = (s: LevelerSnapshot, skill: string) => methodFor(s, skill, emptyMemory(), () => 0)!;
const supply = (s: LevelerSnapshot, item: string) => producer(s, 'smithing', { item, count: 28 }, emptyMemory(), () => 0)!;

test('mining stays on copper/tin through 29 then uses iron at 30', () => {
    const s = snapshot();
    for (const level of [1, 15, 29, 30, 40]) {
        s.levels.mining = level;
        expect(method(s, 'mining').settings.rocks).toEqual([level < 30 ? 'Copper' : 'Iron']);
    }
    s.levels.mining = 29; s.stock['copper ore'] = 28;
    expect(method(s, 'mining').settings.rocks).toEqual(['Tin']);
});

test('woodcutting progresses at 15 and 30 but log dependencies retain their tree type', () => {
    const s = snapshot();
    for (const [level, tree] of [[1, 'Tree'], [14, 'Tree'], [15, 'Oak'], [29, 'Oak'], [30, 'Willow'], [40, 'Willow']] as const) {
        s.levels.woodcutting = level;
        expect(method(s, 'woodcutting').settings.treeName).toBe(tree);
    }
    expect(supply(s, 'Logs').settings.treeName).toBe('Tree');
    expect(supply(s, 'Oak logs').settings.treeName).toBe('Oak');
    expect(supply(s, 'Tin ore').settings.rocks).toEqual(['Tin']);
});

test('firemaking and fletching recipes advance only when their material can be sourced', () => {
    const s = snapshot();
    expect(method(s, 'firemaking').settings.logType).toBe('Willow logs');
    expect(method(s, 'fletching').settings.material).toBe('Willow logs');
    s.levels.woodcutting = 1;
    expect(method(s, 'firemaking').settings.logType).toBe('Logs');
    expect(method(s, 'fletching').settings.material).toBe('Logs');
    s.stock['oak logs'] = 28;
    expect(method(s, 'fletching').settings.material).toBe('Oak logs');
});

test('fletching chooses shafts, shortbows, then longbows at their actual recipe levels', () => {
    const s = snapshot();
    for (const [level, wood, product] of [[1, 'Logs', 'Arrow shafts'], [5, 'Logs', 'Short bow'], [10, 'Logs', 'Long bow'], [20, 'Oak logs', 'Short bow'], [25, 'Oak logs', 'Long bow'], [35, 'Willow logs', 'Short bow'], [40, 'Willow logs', 'Long bow']] as const) {
        s.levels.fletching = level;
        expect(method(s, 'fletching').settings).toMatchObject({ material: wood, product });
    }
});

test('fishing can fall back to a net below 40 but never stays on nets after 40 for training', () => {
    const s = snapshot(); s.levels.fishing = 25; s.stock = { 'small fishing net': 1, coins: 200 };
    expect(method(s, 'fishing').settings.fishMethod).toBe('Small net — shrimp/anchovy');
    s.levels.fishing = 40;
    expect(method(s, 'fishing').settings.fishMethod).toBe('Fly fishing — trout/salmon');
});

test('higher cooking uses banked salmon and can supply lobster without Karamja ferries', () => {
    const s = snapshot(); s.stock['raw salmon'] = 28; s.stock.shrimps = 24;
    expect(method(s, 'cooking').settings.fish).toBe('Raw salmon');
    expect(supply(s, 'Raw lobster').settings).toMatchObject({ fishMethod: 'Lobster cage — lobster', location: 'Catherby' });
    s.levels.cooking = 1;
    expect(method(s, 'cooking').settings.fish).toBe('Raw shrimps');
});

test('method milestones let the controller replan when the next useful method unlocks', () => {
    const s = snapshot(1);
    expect(method(s, 'woodcutting').prerequisiteLevels).toEqual({ woodcutting: 15 });
    expect(method(s, 'mining').prerequisiteLevels).toEqual({ mining: 6 });
    expect(method(s, 'fletching').prerequisiteLevels).toEqual({ fletching: 5 });
});

test('thieving replans when warrior women unlock at 25', () => {
    const s = snapshot(); s.levels.thieving = 24;
    expect(method(s, 'thieving').prerequisiteLevels).toEqual({ thieving: 25 });
});

test('magic upgrades spells and provisions every rune while respecting the shopping budget', () => {
    const s = snapshot(); s.stock.coins = 1000000;
    for (const [level, spell] of [[1, 'Wind Strike'], [5, 'Water Strike'], [13, 'Fire Strike'], [17, 'Wind Bolt'], [35, 'Fire Bolt']] as const) {
        s.levels.magic = level;
        const plan = method(s, 'magic');
        expect(plan.settings.spell).toBe(spell);
        expect(plan.needs.some(n => n.item === (level >= 17 ? 'Chaos rune' : 'Mind rune'))).toBe(true);
    }
    s.stock = { coins: 0, 'staff of air': 1, 'mind rune': 200, shrimps: 24 };
    expect(method(s, 'magic').settings.spell).toBe('Wind Strike');
});

test('banked supplies unlock better smithing, crafting and herblore recipes', () => {
    const s = snapshot(); s.stock['iron bar'] = 28; s.stock.leather = 26;
    s.stock['ranarr weed'] = 14; s.stock['snape grass'] = 14;
    expect(method(s, 'smithing').settings).toMatchObject({ bar: 'Iron', product: 'Platebody' });
    expect(method(s, 'crafting').script).toBe('LeatherCrafter');
    expect(method(s, 'herblore').settings).toMatchObject({ herb: 'Ranarr weed', secondary: 'Snape grass' });
    s.stock['snape grass'] = 0;
    expect(method(s, 'herblore').settings.herb).toBe('Guam leaf');
});

test('thieving advances to farmers with food and banking after level 10', () => {
    const s = snapshot(); s.levels.thieving = 9;
    expect(method(s, 'thieving').settings.target).toBe('Man');
    s.levels.thieving = 10;
    expect(method(s, 'thieving').settings).toMatchObject({ target: 'Farmer', banking: 'Auto', suicide: false });
});

test('unavailable fly supplies fall back to shrimp for cooking and combat food', () => {
    const s = snapshot(); s.levels.fishing = 30; s.levels.cooking = 25;
    s.unavailableItems = ['feather']; s.stock['small fishing net'] = 1;
    expect(method(s, 'cooking').settings.fish).toBe('Raw shrimps');
    expect(method(s, 'attack').food).toBe('Shrimps');
    s.stock['raw salmon'] = 28;
    expect(method(s, 'cooking').settings.fish).toBe('Raw salmon');
});

test('ranged bow upgrades leave enough money for a full ammo loadout', () => {
    const s = snapshot(); s.levels.ranged = 30; s.stock = { coins: 2300, shrimps: 24 };
    const plan = method(s, 'ranged');
    expect(plan.needs.find(n => n.item.endsWith('bow'))?.item).toBe('Shortbow');
});

test('owning high-level food does not permit cooking replacements below the recipe level', () => {
    const s = snapshot(); s.levels.cooking = 1; s.stock.lobster = 24;
    expect(method(s, 'attack').food).toBe('Lobster');
    expect(supply(s, 'Lobster')).toBeNull();
    s.levels.cooking = 40;
    expect(supply(s, 'Lobster').script).toBe('CookBot');
});
