import { describe, expect, test } from 'bun:test';
import { FOOD_OPTIONS } from '#/bot/api/combat/food.js';
import { desertCampFoodReserveDepleted, desertCampFoodReservedSlots, MINER_FOOD_SETTINGS, minerFoodConfig, minerFoodRestockNeeded, planMinerFoodWithdrawal, shouldEatMinerFood, unsupportedCampOres } from '#/bot/scripts/GatheringBot/MinerLogic.js';

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

    test('retains full-pack food needed for a hazardous travel leg', () => {
        expect(
            shouldEatMinerFood({
                hp: 40,
                maxHp: 40,
                heal: 4,
                foodCount: 7,
                inventoryFull: true,
                retainForTravel: true
            })
        ).toBe(false);
        expect(
            shouldEatMinerFood({
                hp: 36,
                maxHp: 40,
                heal: 4,
                foodCount: 7,
                inventoryFull: true,
                retainForTravel: true
            })
        ).toBe(true);
    });

    test('eats at the safety floor even when the full heal cannot fit', () => {
        expect(
            shouldEatMinerFood({
                hp: 5,
                maxHp: 10,
                heal: 12,
                foodCount: 3,
                inventoryFull: false,
                retainForTravel: true
            })
        ).toBe(true);
        expect(
            shouldEatMinerFood({
                hp: 6,
                maxHp: 10,
                heal: 12,
                foodCount: 3,
                inventoryFull: false,
                retainForTravel: true
            })
        ).toBe(false);
    });

    test('eats before Desert Camp heat can kill a low-HP player', () => {
        expect(
            shouldEatMinerFood({
                hp: 9,
                maxHp: 10,
                heal: 12,
                foodCount: 2,
                inventoryFull: false,
                retainForTravel: true,
                hazardMaxHit: 9
            })
        ).toBe(true);
        expect(
            shouldEatMinerFood({
                hp: 10,
                maxHp: 10,
                heal: 12,
                foodCount: 2,
                inventoryFull: false,
                retainForTravel: true,
                hazardMaxHit: 9
            })
        ).toBe(false);
    });
});

describe('Miner food restocking', () => {
    test('keeps one food item in reserve for the Desert Camp exit', () => {
        expect(desertCampFoodReserveDepleted(2)).toBe(false);
        expect(desertCampFoodReserveDepleted(1)).toBe(true);
        expect(desertCampFoodReserveDepleted(0)).toBe(true);
    });

    test('tops up the named food to the exact configured target', () => {
        expect(planMinerFoodWithdrawal({ target: 12, held: 4, banked: 50, freeSlots: 20, reservedSlots: 0 })).toEqual({
            ok: true,
            withdraw: 8
        });
        expect(planMinerFoodWithdrawal({ target: 12, held: 12, banked: 0, freeSlots: 16, reservedSlots: 0 })).toEqual({
            ok: true,
            withdraw: 0
        });
    });

    test('rejects a partial trip when the bank is short', () => {
        expect(planMinerFoodWithdrawal({ target: 12, held: 4, banked: 7, freeSlots: 20, reservedSlots: 0 })).toEqual({
            ok: false,
            withdraw: 0,
            reason: 'bank-stock',
            missing: 1
        });
    });

    test('rejects a target that cannot fit beside the carried gear', () => {
        expect(planMinerFoodWithdrawal({ target: 27, held: 2, banked: 50, freeSlots: 24, reservedSlots: 0 })).toEqual({
            ok: false,
            withdraw: 0,
            reason: 'pack-space',
            missing: 1
        });
    });

    test('keeps route supplies and one ore slot out of the food allowance', () => {
        expect(desertCampFoodReservedSlots(8)).toBe(9);
        expect(
            planMinerFoodWithdrawal({
                target: 20,
                held: 0,
                banked: 50,
                freeSlots: 28,
                reservedSlots: 9
            })
        ).toEqual({
            ok: false,
            withdraw: 0,
            reason: 'pack-space',
            missing: 1
        });
        expect(
            planMinerFoodWithdrawal({
                target: 19,
                held: 19,
                banked: 0,
                freeSlots: 9,
                reservedSlots: 10
            })
        ).toEqual({
            ok: false,
            withdraw: 0,
            reason: 'pack-space',
            missing: 1
        });
    });

    test('allows the exact food maximum beside supplies and the ore slot', () => {
        expect(
            planMinerFoodWithdrawal({
                target: 19,
                held: 0,
                banked: 50,
                freeSlots: 28,
                reservedSlots: 9
            })
        ).toEqual({ ok: true, withdraw: 19 });
    });

    test('restocks once at startup and again only after the trip food is gone', () => {
        expect(minerFoodRestockNeeded({ configured: true, foodCount: 4, startupPending: true })).toBe(true);
        expect(minerFoodRestockNeeded({ configured: true, foodCount: 4, startupPending: false })).toBe(false);
        expect(minerFoodRestockNeeded({ configured: true, foodCount: 0, startupPending: false })).toBe(true);
        expect(minerFoodRestockNeeded({ configured: false, foodCount: 0, startupPending: true })).toBe(false);
    });
});

describe('named-camp ore validation', () => {
    test('accepts the four live Desert Mining Camp ores and rejects absent Coal', () => {
        const supported = ['copper', 'tin', 'mithril', 'adamantite'];
        expect(unsupportedCampOres(['Copper', 'Tin', 'Mithril', 'Adamantite'], supported)).toEqual([]);
        expect(unsupportedCampOres(['Coal'], supported)).toEqual(['Coal']);
    });

    test('accepts the four live Desert Mining Camp Surface ores and rejects underground-only Mithril', () => {
        const supported = ['copper', 'tin', 'iron', 'coal'];
        expect(unsupportedCampOres(['Copper', 'Tin', 'Iron', 'Coal'], supported)).toEqual([]);
        expect(unsupportedCampOres(['Mithril'], supported)).toEqual(['Mithril']);
    });

    test('matches ore names case-insensitively and leaves freeform camps alone', () => {
        expect(unsupportedCampOres(['Mithril', 'ADAMANTITE'], ['mithril', 'adamantite'])).toEqual([]);
        expect(unsupportedCampOres(['Coal'], undefined)).toEqual([]);
    });
});
