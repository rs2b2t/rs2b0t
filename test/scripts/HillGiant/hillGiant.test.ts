import { describe, expect, test } from 'bun:test';
import {
    BIG_BONES,
    BRASS_KEY,
    LIMPWURT,
    PIT_SPOTS,
    bonesAction,
    isHillGiantKill,
    keepOnDeposit,
    pickSpot,
    shouldBank,
    shouldEatForSpace,
    tripNeeds
} from '#/bot/scripts/HillGiant/HillGiantLogic.js';
import { HILL_GIANT_SETTINGS } from '#/bot/scripts/HillGiant/HillGiant.js';

describe('HillGiant pit spots', () => {
    test('every spot sits inside the giant pit', () => {
        // the pit measured on a rev-274 engine: giants spawn x 3100-3123, z 9827-9851
        expect(PIT_SPOTS.length).toBeGreaterThan(1);
        for (const s of PIT_SPOTS) {
            expect(s.x).toBeGreaterThanOrEqual(3100);
            expect(s.x).toBeLessThanOrEqual(3123);
            expect(s.z).toBeGreaterThanOrEqual(9827);
            expect(s.z).toBeLessThanOrEqual(9851);
            expect(s.level).toBe(0);
        }
    });

    test('spots are spread out, not clustered on one corner', () => {
        // the point is that several bots do not pile onto one tile
        for (let i = 0; i < PIT_SPOTS.length; i++) {
            for (let j = i + 1; j < PIT_SPOTS.length; j++) {
                const a = PIT_SPOTS[i];
                const b = PIT_SPOTS[j];
                expect(Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z))).toBeGreaterThanOrEqual(3);
            }
        }
    });

    test('picking covers every spot across the random range', () => {
        const picked = new Set<string>();
        for (let i = 0; i < 1000; i++) {
            const s = pickSpot(i / 1000);
            picked.add(`${s.x},${s.z}`);
        }
        expect(picked.size).toBe(PIT_SPOTS.length);
    });

    test('picking never falls off either end of the range', () => {
        expect(() => pickSpot(0)).not.toThrow();
        expect(() => pickSpot(0.9999999)).not.toThrow();
        expect(pickSpot(1)).toBe(PIT_SPOTS[PIT_SPOTS.length - 1]);
        expect(pickSpot(-1)).toBe(PIT_SPOTS[0]);
        expect(pickSpot(Number.NaN)).toBe(PIT_SPOTS[0]);
    });

    test('an empty spot list fails loudly rather than picking nothing', () => {
        expect(() => pickSpot(0.5, [])).toThrow(/no pit spots/);
    });
});

describe('HillGiant trip needs', () => {
    test('withdraws a key only when one is not already carried', () => {
        expect(tripNeeds(false, 0, 12).key).toBe(true);
        expect(tripNeeds(true, 0, 12).key).toBe(false);
    });

    test('tops food up to the trip size rather than always withdrawing a full load', () => {
        expect(tripNeeds(true, 0, 12).food).toBe(12);
        expect(tripNeeds(true, 5, 12).food).toBe(7);
        expect(tripNeeds(true, 12, 12).food).toBe(0);
        expect(tripNeeds(true, 20, 12).food).toBe(0);
    });

    test('keeps the key and the food when depositing loot', () => {
        expect(keepOnDeposit('Trout')).toEqual([BRASS_KEY, 'Trout']);
    });
});

describe('HillGiant pack management', () => {
    test('eats for space only when full and holding food', () => {
        expect(shouldEatForSpace(0, 3)).toBe(true);
        expect(shouldEatForSpace(0, 0)).toBe(false);
        expect(shouldEatForSpace(2, 3)).toBe(false);
    });

    const vitals = { hp: 50, maxHp: 53, heal: 12 };

    test('banks once the loot target is hit', () => {
        expect(shouldBank({ freeSlots: 5, foodInPack: 3, lootSlotsTarget: 14, usedLootSlots: 14, ...vitals })).toBe(true);
        expect(shouldBank({ freeSlots: 5, foodInPack: 3, lootSlotsTarget: 14, usedLootSlots: 13, ...vitals })).toBe(false);
    });

    test('banks when full with no food left to eat for room', () => {
        expect(shouldBank({ freeSlots: 0, foodInPack: 0, lootSlotsTarget: 14, usedLootSlots: 2, ...vitals })).toBe(true);
        expect(shouldBank({ freeSlots: 0, foodInPack: 4, lootSlotsTarget: 14, usedLootSlots: 2, ...vitals })).toBe(false);
    });

    test('banks when out of food and HP is in the smart-eat band (full heal would fit)', () => {
        // lobster 12, 40/53: room 13 ≥ 12 → would eat if food remained → bank
        expect(
            shouldBank({ freeSlots: 10, foodInPack: 0, lootSlotsTarget: 14, usedLootSlots: 2, hp: 40, maxHp: 53, heal: 12 })
        ).toBe(true);
        // 42/53: room 11 < 12 and above safety floor → stay and fight a bit longer
        expect(
            shouldBank({ freeSlots: 10, foodInPack: 0, lootSlotsTarget: 14, usedLootSlots: 2, hp: 42, maxHp: 53, heal: 12 })
        ).toBe(false);
        // still has food — eat in place, do not bank yet
        expect(
            shouldBank({ freeSlots: 10, foodInPack: 3, lootSlotsTarget: 14, usedLootSlots: 2, hp: 40, maxHp: 53, heal: 12 })
        ).toBe(false);
        // safety floor with empty pack
        expect(
            shouldBank({ freeSlots: 10, foodInPack: 0, lootSlotsTarget: 14, usedLootSlots: 2, hp: 5, maxHp: 53, heal: 12 })
        ).toBe(true);
    });

    test('big bones are buried or banked, never both', () => {
        expect(bonesAction(true)).toBe('bury');
        expect(bonesAction(false)).toBe('bank');
    });
});

describe('HillGiant kill counter (#479)', () => {
    test('despawn (not still present) confirms a kill', () => {
        expect(isHillGiantKill(false)).toBe(true);
    });

    test('still on the scene is not a kill — do not count on Attack click', () => {
        expect(isHillGiantKill(true)).toBe(false);
    });
});

describe('HillGiant settings', () => {
    test('loots limpwurt roots and big bones by default, as the issue asks', () => {
        expect(HILL_GIANT_SETTINGS.loot.default).toEqual([LIMPWURT, BIG_BONES]);
    });

    test('banks big bones unless burying is turned on', () => {
        expect(HILL_GIANT_SETTINGS.buryBones.default).toBe(false);
    });

    test('carries food by default', () => {
        expect(HILL_GIANT_SETTINGS.foodWithdraw.default).toBeGreaterThan(0);
    });

    test('offers a weapon to keep wielded, so a death can re-wield it', () => {
        // the issue asks the bot to re-equip its gear after dying; blank means
        // "fight with whatever is already worn" rather than silently doing nothing
        expect(HILL_GIANT_SETTINGS.weapon).toBeDefined();
        expect(HILL_GIANT_SETTINGS.weapon.default).toBe('');
        expect(String(HILL_GIANT_SETTINGS.weapon.help)).toMatch(/death|re-worn/i);
    });

    test('melee style setting is applied by the script (not display-only)', () => {
        expect(HILL_GIANT_SETTINGS.meleeStyle).toMatchObject({
            type: 'string',
            default: 'strength',
            options: ['attack', 'strength', 'controlled', 'defence']
        });
    });
});
