import { describe, expect, test } from 'bun:test';
import { FOOD_OPTIONS } from '#/bot/api/combat/food.js';
import { MINER_FOOD_SETTINGS, minerFoodConfig, minerFoodRestockNeeded, planMinerFoodWithdrawal, shouldEatMinerFood } from '#/bot/scripts/GatheringBot/MinerLogic.js';

describe('Miner food settings', () => {
    test('food is opt-in, named, and bounded to the usable pack size', () => {
        expect(MINER_FOOD_SETTINGS.food.options).toEqual(FOOD_OPTIONS);
        expect(MINER_FOOD_SETTINGS.foodWithdraw).toMatchObject({ default: 0, min: 0, max: 27 });
        expect(minerFoodConfig('Lobster', 0)).toBeNull();
        expect(minerFoodConfig('  Swordfish  ', 12.9)).toEqual({ name: 'Swordfish', target: 12 });
        expect(minerFoodConfig('Lobster', 99)).toEqual({ name: 'Lobster', target: 27 });
        expect(minerFoodConfig('', 12)).toBeNull();
    });

    test('the bundled Miner exposes both food controls', async () => {
        const { ScriptRegistry } = await import('#/bot/runtime/ScriptRegistry.js');
        await import('#/bot/scripts/index.js');
        const settings = ScriptRegistry.get('Miner')?.settingsSchema;
        expect(settings?.food).toEqual(MINER_FOOD_SETTINGS.food);
        expect(settings?.foodWithdraw).toEqual(MINER_FOOD_SETTINGS.foodWithdraw);
    });
});

describe('Miner eating policy', () => {
    test('eats at the exact no-overheal boundary', () => {
        expect(shouldEatMinerFood({ hp: 28, maxHp: 40, heal: 12, foodCount: 1, inventoryFull: false })).toBe(true);
        expect(shouldEatMinerFood({ hp: 29, maxHp: 40, heal: 12, foodCount: 1, inventoryFull: false })).toBe(false);
    });

    test('does not eat without usable food or a living HP state', () => {
        expect(shouldEatMinerFood({ hp: 10, maxHp: 40, heal: 12, foodCount: 0, inventoryFull: true })).toBe(false);
        expect(shouldEatMinerFood({ hp: 0, maxHp: 40, heal: 12, foodCount: 1, inventoryFull: false })).toBe(false);
        expect(shouldEatMinerFood({ hp: 10, maxHp: 40, heal: 0, foodCount: 1, inventoryFull: false })).toBe(false);
    });

    test('eats from a full pack even at full HP to make one more ore slot', () => {
        expect(shouldEatMinerFood({ hp: 40, maxHp: 40, heal: 12, foodCount: 3, inventoryFull: true })).toBe(true);
        expect(shouldEatMinerFood({ hp: 40, maxHp: 40, heal: 12, foodCount: 3, inventoryFull: false })).toBe(false);
    });
});

describe('Miner food restocking', () => {
    test('tops up the named food to the exact configured target', () => {
        expect(planMinerFoodWithdrawal({ target: 12, held: 4, banked: 50, freeSlots: 20 })).toEqual({
            ok: true,
            withdraw: 8
        });
        expect(planMinerFoodWithdrawal({ target: 12, held: 12, banked: 0, freeSlots: 16 })).toEqual({
            ok: true,
            withdraw: 0
        });
    });

    test('rejects a partial trip when the bank is short', () => {
        expect(planMinerFoodWithdrawal({ target: 12, held: 4, banked: 7, freeSlots: 20 })).toEqual({
            ok: false,
            withdraw: 0,
            reason: 'bank-stock',
            missing: 1
        });
    });

    test('rejects a target that cannot fit beside the carried gear', () => {
        expect(planMinerFoodWithdrawal({ target: 27, held: 2, banked: 50, freeSlots: 24 })).toEqual({
            ok: false,
            withdraw: 0,
            reason: 'pack-space',
            missing: 1
        });
    });

    test('restocks once at startup and again only after the trip food is gone', () => {
        expect(minerFoodRestockNeeded({ configured: true, foodCount: 4, startupPending: true })).toBe(true);
        expect(minerFoodRestockNeeded({ configured: true, foodCount: 4, startupPending: false })).toBe(false);
        expect(minerFoodRestockNeeded({ configured: true, foodCount: 0, startupPending: false })).toBe(true);
        expect(minerFoodRestockNeeded({ configured: false, foodCount: 0, startupPending: true })).toBe(false);
    });
});
