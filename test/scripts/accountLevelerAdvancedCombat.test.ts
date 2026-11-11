import { expect, test } from 'bun:test';
import { COMBAT_CAMPS, combatPlan } from '#/bot/scripts/AccountLeveler/combat.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

const snapshot = (level = 80): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, level])),
    stock: { coins: 100000, lobster: 100, 'climbing boots': 1 }, bankReady: true,
    quests: {}, target: 90, wilderness: false, allowQuests: false, now: 1000
});
const isolate = (id: string) => ({ ...emptyMemory(), cooldowns: Object.fromEntries(COMBAT_CAMPS.filter(c => c.id !== id).map(c => [c.id, 2000])) });

test.each([
    ['crandor-lesser-demons', 'Dragon Slayer'],
    ['crandor-moss-giants', 'Dragon Slayer'],
    ['canifis-south-ghouls', 'Priest in Peril'],
    ['troll-stronghold-trolls', 'Troll Stronghold'],
    ['lighthouse-dagannoths', 'Horror from the Deep'],
    ['gu-tanoth-ogres', 'Watch Tower'],
    ['gu-tanoth-city-guards', 'Watch Tower']
])('%s unlocks from completed %s with automatic questing disabled', (id, quest) => {
    const s = snapshot();
    const memory = isolate(id);
    expect(methodFor(s, 'attack', memory, () => 0)).toBeNull();
    s.quests[quest] = true;
    expect(methodFor(s, 'attack', memory, () => 0)?.id).toBe(id);
});

test.each(['brimhaven-pirates', 'brimhaven-thieves', 'karamja-lesser-demons', 'falador-west-guards', 'edgeville-guards', 'varrock-south-guards', 'ardougne-north-guards', 'khazard-west-troopers'])('%s can train without quest completions', id => {
    expect(combatPlan(snapshot(), 'attack', isolate(id), () => 0)?.id).toBe(id);
});

test('upper palace guards preserve their floor through travel and fighter settings', () => {
    const plan = combatPlan(snapshot(), 'ranged', isolate('varrock-palace-upper-guards'), () => 0);
    expect(plan?.travel).toMatchObject({ x: 3204, z: 3495, level: 1 });
    expect(plan?.settings.coordinates).toMatchObject({ x: 3204, z: 3495, level: 1 });
});

test('troll travel requires agility and owned climbing boots, then equips them', () => {
    const s = snapshot();
    s.quests['Troll Stronghold'] = true;
    const memory = isolate('troll-stronghold-trolls');
    s.levels.agility = 14;
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.levels.agility = 15;
    s.stock['climbing boots'] = 0;
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.stock['climbing boots'] = 1;
    const plan = combatPlan(s, 'attack', memory, () => 0);
    expect(plan?.needs).toContainEqual({ item: 'Climbing boots', count: 1, carry: 1, equip: true });
});

test('Gu Tanoth city guard access requires agility even after Watch Tower', () => {
    const s = snapshot();
    s.quests['Watch Tower'] = true;
    s.levels.agility = 24;
    expect(combatPlan(s, 'attack', isolate('gu-tanoth-city-guards'), () => 0)).toBeNull();
    s.levels.agility = 25;
    expect(combatPlan(s, 'attack', isolate('gu-tanoth-city-guards'), () => 0)?.id).toBe('gu-tanoth-city-guards');
});

test('demons require stronger food that is stocked or producible', () => {
    const s = snapshot();
    s.stock = { coins: 100000, shrimps: 100 };
    s.levels.fishing = s.levels.cooking = 1;
    const memory = isolate('karamja-lesser-demons');
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.stock.lobster = 24;
    expect(combatPlan(s, 'attack', memory, () => 0)?.food).toBe('Lobster');
    s.stock.lobster = 0;
    s.levels.fishing = s.levels.cooking = 40;
    expect(combatPlan(s, 'attack', memory, () => 0)?.food).toBe('Lobster');
});

test('lesser demons never become a Prayer training method', () => {
    const s = snapshot();
    expect(combatPlan(s, 'attack', isolate('karamja-lesser-demons'), () => 0)?.id).toBe('karamja-lesser-demons');
    expect(combatPlan(s, 'prayer', isolate('karamja-lesser-demons'), () => 0)).toBeNull();
});

test('higher combat bands retire guards and pirates without forcing locked dungeons', () => {
    const s = snapshot(65);
    const targets = new Set<string>();
    for (let i = 0; i < 100; i++) targets.add(String(combatPlan(s, 'attack', emptyMemory(), () => i / 100)?.settings.target));
    expect(targets.has('Lesser demon')).toBe(true);
    expect(targets.has('Pirate')).toBe(false);
    expect(targets.has('Guard')).toBe(false);
    expect(targets.has('Dagannoth')).toBe(false);
    s.levels = snapshot(30).levels;
    expect(combatPlan(s, 'attack', isolate('karamja-lesser-demons'), () => 0)).toBeNull();
});

test('travel coins are reserved for equipment shopping and replenished by the fighter', () => {
    const s = snapshot();
    const plan = combatPlan(s, 'attack', isolate('brimhaven-pirates'), () => 0);
    expect(plan?.needs).toContainEqual({ item: 'Coins', count: 200, carry: 200 });
    expect(plan?.settings.travelCoins).toBe(200);
    s.stock.coins = 199;
    expect(combatPlan(s, 'attack', isolate('brimhaven-pirates'), () => 0)).toBeNull();
});

test.each([
    ['brimhaven-dungeon-moss-giants', 27, 1, 5],
    ['brimhaven-dungeon-fire-giants', 10, 12, 6]
])('%s packs an axe and entry fees and enforces the route skills', (id, woodcutting, agility, radius) => {
    const s = snapshot();
    const memory = isolate(String(id));
    s.levels.woodcutting = Number(woodcutting);
    s.levels.agility = Number(agility);
    const plan = combatPlan(s, 'attack', memory, () => 0);
    expect(plan?.needs).toContainEqual({ item: 'Coins', count: 1200, carry: 1200 });
    expect(plan?.needs).toContainEqual({ item: 'Bronze axe', count: 1, carry: 1 });
    expect(plan?.settings.travelCoins).toBe(1200);
    expect(plan?.settings.travelItems).toEqual(['Bronze axe']);
    expect(plan?.settings.leashRadius).toBe(radius);
    s.levels.woodcutting--;
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.levels.woodcutting++;
    if (Number(agility) > 1) {
        s.levels.agility--;
        expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
        s.levels.agility++;
    }
    s.stock.coins = 1199;
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.stock.coins = 1200;
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.stock['bronze axe'] = 1;
    expect(combatPlan(s, 'attack', memory, () => 0)?.id).toBe(id);
});

test('an unavailable dungeon tool excludes the camp until the tool is owned', () => {
    const s = snapshot();
    s.unavailableItems = ['bronze axe'];
    const memory = isolate('brimhaven-dungeon-moss-giants');
    expect(combatPlan(s, 'attack', memory, () => 0)).toBeNull();
    s.stock['bronze axe'] = 1;
    expect(combatPlan(s, 'attack', memory, () => 0)?.id).toBe('brimhaven-dungeon-moss-giants');
});
