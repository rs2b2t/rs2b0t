import { describe, expect, test } from 'bun:test';
import { COORD_TOOL_SLOTS, TRAIL_FOOD_CAP, casketRewardSlots, trailFoodTarget, weaponNeeded } from '#/bot/api/ai/clues/packPlan.js';

const budget = (over: Partial<Parameters<typeof trailFoodTarget>[0]> = {}) => ({
    hostWant: 20,
    heldFood: 0,
    freeSlots: 22,
    reserveSlots: 0,
    ...over
});

describe('trailFoodTarget', () => {
    test('caps a grind-sized request down to trail size', () => {
        expect(trailFoodTarget(budget({ hostWant: 20 }))).toBe(TRAIL_FOOD_CAP);
    });
    test('a host asking for less than the cap still gets what it asked for', () => {
        expect(trailFoodTarget(budget({ hostWant: 6 }))).toBe(6);
    });
    test('never takes slots the coord tools still need', () => {
        expect(trailFoodTarget(budget({ freeSlots: 5, reserveSlots: COORD_TOOL_SLOTS }))).toBe(2);
    });
    test('a pack with no room takes no food', () => {
        expect(trailFoodTarget(budget({ freeSlots: 0 }))).toBe(0);
        expect(trailFoodTarget(budget({ freeSlots: 2, reserveSlots: COORD_TOOL_SLOTS }))).toBe(0);
    });
    test('food already held counts toward the target rather than being re-bought', () => {
        expect(trailFoodTarget(budget({ heldFood: 8, freeSlots: 0 }))).toBe(8);
        expect(trailFoodTarget(budget({ heldFood: 12, freeSlots: 0 }))).toBe(TRAIL_FOOD_CAP);
    });
    test('the whole point: a 20-food host leaves room for the 5 teleport runes', () => {
        // hard coord clue aboard: clue + spade + trio + coins = 6 used of 28
        const free = 28 - 6;
        expect(free - trailFoodTarget(budget({ hostWant: 20, freeSlots: free }))).toBeGreaterThanOrEqual(5);
    });
});

describe('weaponNeeded', () => {
    test('not needed when it is already worn (the duplicate-weapon bug)', () => {
        expect(weaponNeeded('Rune scimitar', false, true)).toBe(false);
    });
    test('not needed when it is already in the pack', () => {
        expect(weaponNeeded('Rune scimitar', true, false)).toBe(false);
    });
    test('needed when the account has none', () => {
        expect(weaponNeeded('Rune scimitar', false, false)).toBe(true);
    });
    test('a host with no weapon never withdraws one', () => {
        expect(weaponNeeded('', false, false)).toBe(false);
    });
});

describe('casketRewardSlots', () => {
    test('covers the worst roll of each tier', () => {
        expect(casketRewardSlots('trail_clue_easy_map001_casket')).toBe(4);
        expect(casketRewardSlots('trail_clue_medium_sextant004_casket')).toBe(5);
        expect(casketRewardSlots('trail_clue_hard_sextant001_casket')).toBe(6);
    });
    test('an unrecognised casket still reserves the easy-tier minimum', () => {
        expect(casketRewardSlots('mystery_casket')).toBe(4);
    });
});
