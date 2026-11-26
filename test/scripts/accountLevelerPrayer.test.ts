import { expect, test } from 'bun:test';
import { bankedPrayerPlan, babyDragonPrayerPlan } from '#/bot/scripts/AccountLeveler/prayer.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 70])),
    stock: { coins: 100000, lobster: 100, 'bronze axe': 1, 'dusty key': 1, 'dragonfire shield': 1 },
    bankReady: true, quests: {}, target: 80, wilderness: false, now: 1000
});
const blue = 'taverley-baby-blue-dragons';
const red = 'brimhaven-baby-red-dragons';

test.each([['Dragon bones', 'dragon bones'], ['Babydragon bones', 'babydragon bones'], ['Big bones', 'big bones']])('buries even one owned %s using its exact item name', (name, key) => {
    const s = snapshot();
    s.stock[key] = 1;
    const plan = bankedPrayerPlan(s);
    expect(plan).toMatchObject({ objective: 'prayer', script: 'BoneBurier', settings: { boneName: name }, needs: [{ item: name, count: 1 }] });
    expect(resolveActivity(s, plan!, emptyMemory(), () => 0).kind).toBe('activity');
});

test('prefers owned dragon bones over baby bones without manufacturing a full inventory', () => {
    const s = snapshot();
    s.stock['dragon bones'] = 3;
    s.stock['babydragon bones'] = 100;
    expect(bankedPrayerPlan(s)?.settings.boneName).toBe('Dragon bones');
    expect(bankedPrayerPlan(s)?.needs).toEqual([{ item: 'Dragon bones', count: 3 }]);
    delete s.stock['dragon bones'];
    expect(bankedPrayerPlan(s)?.needs).toEqual([{ item: 'Babydragon bones', count: 28 }]);
});

test('does not plan banked burials without known owned bones', () => {
    const s = snapshot();
    expect(bankedPrayerPlan(s)).toBeNull();
    s.stock['babydragon bones'] = 10;
    s.bankReady = false;
    expect(bankedPrayerPlan(s)).toBeNull();
});

test.each([[0, blue, 'Baby blue dragon'], [0.99, red, 'Baby red dragon']])('selects eligible baby dragon option %s and buries its drops', (roll, id, target) => {
    const s = snapshot();
    const before = structuredClone(s);
    const plan = babyDragonPrayerPlan(s, emptyMemory(), () => Number(roll));
    expect(plan).toMatchObject({ id, objective: 'prayer', combat: true, script: 'AutoFighter', settings: { target, buryBabyDragonBones: true } });
    expect(plan?.needs).toContainEqual({ item: 'Dragonfire shield', count: 1, carry: 1, equip: true });
    expect(s).toEqual(before);
});

test('baby red dragons retain the dungeon fee, axe, route levels and combat gates', () => {
    const s = snapshot();
    const memory = { ...emptyMemory(), cooldowns: { [blue]: 2000 } };
    const plan = babyDragonPrayerPlan(s, memory, () => 0);
    expect(plan?.id).toBe(red);
    expect(plan?.needs).toContainEqual({ item: 'Coins', count: 1200, carry: 1200 });
    expect(plan?.needs).toContainEqual({ item: 'Bronze axe', count: 1, carry: 1 });
    expect(plan?.settings.travelItems).toContain('Bronze axe');
    for (const [skill, level] of [['woodcutting', 21], ['agility', 29], ['hitpoints', 59], ['defence', 59], ['attack', 54], ['strength', 54]] as const) {
        const locked = structuredClone(s);
        locked.levels[skill] = level;
        expect(babyDragonPrayerPlan(locked, memory, () => 0), skill).toBeNull();
    }
    s.stock.coins = 1199;
    expect(babyDragonPrayerPlan(s, memory, () => 0)).toBeNull();
    s.stock.coins = 100000;
    s.stock['bronze axe'] = 0;
    s.unavailableItems = ['bronze axe'];
    expect(babyDragonPrayerPlan(s, memory, () => 0)).toBeNull();
});

test('baby dragon options honor missing access items, food and cooldowns', () => {
    const s = snapshot();
    s.stock['dusty key'] = 0;
    expect(babyDragonPrayerPlan(s, emptyMemory(), () => 0)?.id).toBe(red);
    s.stock['dragonfire shield'] = 0;
    expect(babyDragonPrayerPlan(s, emptyMemory(), () => 0)).toBeNull();
    s.stock['dragonfire shield'] = 1;
    s.stock.lobster = 0;
    s.levels.fishing = s.levels.cooking = 1;
    expect(babyDragonPrayerPlan(s, emptyMemory(), () => 0)).toBeNull();
    expect(babyDragonPrayerPlan(snapshot(), { ...emptyMemory(), cooldowns: { [blue]: 2000, [red]: 2000 } }, () => 0)).toBeNull();
});

test('rotates away from a recently visited baby dragon camp', () => {
    expect(babyDragonPrayerPlan(snapshot(), { ...emptyMemory(), recent: [blue] }, () => 0)?.id).toBe(red);
});

test.each([blue, red])('%s requires the same protection and combat floors around adult dragons', id => {
    const memory = { ...emptyMemory(), cooldowns: { [id === blue ? red : blue]: 2000 } };
    const s = snapshot();
    s.stock['dragonfire shield'] = 0;
    expect(babyDragonPrayerPlan(s, memory, () => 0)).toBeNull();
    for (const [skill, level] of [['hitpoints', 59], ['defence', 59], ['attack', 54], ['strength', 54]] as const) {
        const locked = snapshot();
        locked.levels[skill] = level;
        expect(babyDragonPrayerPlan(locked, memory, () => 0), skill).toBeNull();
    }
});

test('Prayer selection uses partial banked baby bones even below level 60', () => {
    const s = snapshot();
    s.levels.prayer = 20;
    s.stock['babydragon bones'] = 3;
    expect(methodFor(s, 'prayer', emptyMemory(), () => 0)?.settings.boneName).toBe('Babydragon bones');
});

test('Prayer selection can rotate from adult dragons into baby red dragons', () => {
    const s = snapshot();
    s.quests['Dragon Slayer'] = true;
    const memory = { ...emptyMemory(), recent: ['prayer-blue-dragons'], cooldowns: { [blue]: 2000 } };
    expect(methodFor(s, 'prayer', memory, () => 0)?.settings.target).toBe('Baby red dragon');
});
