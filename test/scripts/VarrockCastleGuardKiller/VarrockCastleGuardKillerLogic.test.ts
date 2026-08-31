import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { SETTINGS as GUARD_SETTINGS } from '#/bot/scripts/VarrockCastleGuardKiller/VarrockCastleGuardKiller.js';
import {
    BANK_STAND,
    CAMP_RADIUS,
    CANT_REACH_RE,
    COURT_X1,
    COURT_X2,
    DEATH_RE,
    FOOD_TYPES,
    GUARD_CAMP,
    LOOT_DEFS,
    STYLE_LOWEST,
    STYLE_RANDOM,
    buildWithdrawPlan,
    clampFoodAmount,
    clampPercent,
    describeFood,
    hpPercent,
    inCamp,
    inCourtyard,
    isAnySeedName,
    isBoneName,
    isCastleGuardName,
    isKeepOnDeposit,
    isRandomStyleMode,
    lootDefMatches,
    namesMatchWanted,
    needEat,
    needPanicExit,
    pickLowestStyle,
    shouldLootName,
    shouldRotateStyle
} from '#/bot/scripts/VarrockCastleGuardKiller/VarrockCastleGuardKillerLogic.js';

describe('Varrock palace courtyard', () => {
    test('pins the fountain camp and Varrock west bank', () => {
        expect(GUARD_CAMP).toEqual(new Tile(3212, 3464, 0));
        expect(BANK_STAND).toEqual(new Tile(3185, 3440, 0));
        expect(CAMP_RADIUS).toBe(12);
    });

    test('courtyard is the fountain square on the ground floor', () => {
        expect(inCourtyard(GUARD_CAMP)).toBe(true);
        expect(inCourtyard(new Tile(COURT_X1, 3464, 0))).toBe(true);
        expect(inCourtyard(new Tile(COURT_X2, 3464, 0))).toBe(true);
        expect(inCourtyard(new Tile(3212, 3464, 1))).toBe(false);
        expect(inCourtyard(new Tile(3212, 3457, 0))).toBe(false);
        expect(inCourtyard(BANK_STAND)).toBe(false);
        expect(inCamp(GUARD_CAMP)).toBe(true);
        expect(inCamp(new Tile(3212 + CAMP_RADIUS, 3464, 0))).toBe(true);
        expect(inCamp(new Tile(3212 + CAMP_RADIUS + 1, 3464, 0))).toBe(false);
    });

    test('only NPCs named Guard count', () => {
        expect(isCastleGuardName('Guard')).toBe(true);
        expect(isCastleGuardName('Paladin')).toBe(false);
        expect(isCastleGuardName('Guard dog')).toBe(false);
    });
});

describe('food and panic', () => {
    test('Best food prefers Swordfish then Lobster, Tuna, Shrimp', () => {
        expect(FOOD_TYPES.Best.eat).toEqual(['Swordfish', 'Lobster', 'Tuna', 'Shrimps', 'Shrimp']);
        expect(describeFood('Best')).toContain('Swordfish');
        expect(clampPercent(0)).toBe(1);
        expect(clampPercent(150)).toBe(100);
        expect(clampFoodAmount(0)).toBe(1);
        expect(clampFoodAmount(40)).toBe(28);
        expect(hpPercent(25, 50)).toBe(50);
        expect(needEat(true, 50, 50)).toBe(true);
        expect(needEat(true, 51, 50)).toBe(false);
        expect(needEat(false, 10, 50)).toBe(false);
        expect(needPanicExit(0, 25, 25)).toBe(true);
        expect(needPanicExit(1, 10, 25)).toBe(false);
        expect(needPanicExit(0, 26, 25)).toBe(false);
    });

    test('withdraws Best mix highest-healing first', () => {
        const bank: Record<string, number> = { Swordfish: 2, Lobster: 10, Tuna: 20 };
        const plan = buildWithdrawPlan(8, 10, FOOD_TYPES.Best.withdraw, name => bank[name] ?? 0);
        expect(plan).toEqual([
            { name: 'Swordfish', take: 2 },
            { name: 'Lobster', take: 6 }
        ]);
    });

    test('keeps selected food and bury-bones on deposit', () => {
        expect(isKeepOnDeposit('Lobster', ['Lobster'], false)).toBe(true);
        expect(isKeepOnDeposit('Bones', ['Lobster'], true)).toBe(true);
        expect(isKeepOnDeposit('Bones', ['Lobster'], false)).toBe(false);
        expect(isKeepOnDeposit('Iron dagger', ['Lobster'], true)).toBe(false);
    });
});

describe('own-kill loot ticks', () => {
    test('matches Guard drop names including stacks and seeds', () => {
        expect(namesMatchWanted('3 x Steel arrow', 'steel arrow')).toBe(true);
        expect(namesMatchWanted('Coins (25)', 'coins')).toBe(true);
        expect(namesMatchWanted('Iron bolts', 'iron bolt')).toBe(true);
        expect(isAnySeedName('Guam seed')).toBe(true);
        expect(isAnySeedName('Seeds')).toBe(true);
        expect(isBoneName('Bones')).toBe(true);
        expect(isBoneName('Big bones')).toBe(false);
        const seeds = LOOT_DEFS.find(d => d.key === 'lootSeeds')!;
        expect(lootDefMatches(seeds, 'Marrentill seed')).toBe(true);
        const allOn = Object.fromEntries(LOOT_DEFS.map(d => [d.key, true]));
        expect(shouldLootName('Steel arrow', false, allOn)).toBe(true);
        expect(shouldLootName('Bones', true, { lootBones: false })).toBe(true);
        expect(shouldLootName('Bones', false, { lootBones: false })).toBe(false);
        expect(shouldLootName('Cowhide', true, allOn)).toBe(false);
    });
});

describe('combat style', () => {
    test('rotates after N levels or stays on the lowest melee stat', () => {
        expect(isRandomStyleMode(STYLE_RANDOM)).toBe(true);
        expect(isRandomStyleMode(STYLE_LOWEST)).toBe(false);
        expect(shouldRotateStyle(6, 1, 5)).toBe(true);
        expect(shouldRotateStyle(5, 1, 5)).toBe(false);
        expect(pickLowestStyle({ attack: 40, strength: 30, defence: 50 }, null)).toBe('strength');
        expect(pickLowestStyle({ attack: 30, strength: 30, defence: 40 }, 'attack')).toBe('attack');
    });
});

describe('panel settings', () => {
    test('exposes food, panic, style, bury, and Guard loot ticks', () => {
        expect(GUARD_SETTINGS.foodType).toMatchObject({ type: 'string', default: 'Best', options: ['Best', 'Lobster', 'Tuna', 'Swordfish', 'Shrimp'] });
        expect(GUARD_SETTINGS.foodWithdraw).toMatchObject({ type: 'number', default: 20, min: 1, max: 28 });
        expect(GUARD_SETTINGS.eatAtPercent).toMatchObject({ type: 'number', default: 50 });
        expect(GUARD_SETTINGS.panicHpPercent).toMatchObject({ type: 'number', default: 25 });
        expect(GUARD_SETTINGS.styleMode).toMatchObject({ type: 'string', default: STYLE_RANDOM, options: [STYLE_RANDOM, STYLE_LOWEST] });
        expect(GUARD_SETTINGS.levelsBeforeSwap).toMatchObject({
            showIf: { key: 'styleMode', anyOf: [STYLE_RANDOM] }
        });
        expect(GUARD_SETTINGS.buryBones).toMatchObject({ type: 'boolean', default: true });
        expect(GUARD_SETTINGS.lootCoins).toMatchObject({ type: 'boolean', default: true, group: 'Loot' });
        expect(GUARD_SETTINGS.lootSeeds).toMatchObject({ type: 'boolean', default: true });
        expect(DEATH_RE.test('Oh dear, you are dead!')).toBe(true);
        expect(CANT_REACH_RE.test("I can't reach that!")).toBe(true);
    });
});
