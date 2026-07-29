import { describe, expect, test } from 'bun:test';
import {
    NAMED_CAMP_LEASH_FLOOR,
    effectiveGatherLeash,
    fishingSessionBroken,
    shouldYieldGathering
} from '#/bot/scripts/GatheringBot.js';

describe('effectiveGatherLeash', () => {
    test('Auto keeps the UI setting (freeform / unverified snaps)', () => {
        expect(effectiveGatherLeash(12, 'Auto')).toBe(12);
        expect(effectiveGatherLeash(18, 'auto')).toBe(18);
        expect(effectiveGatherLeash(40, 'Auto')).toBe(40);
    });

    test('named camps floor to NAMED_CAMP_LEASH_FLOOR (Catherby-scale)', () => {
        expect(effectiveGatherLeash(10, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(18, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(12, 'Southwest Varrock Mine')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(40, 'Draynor Village')).toBe(40);
    });

    test('None (power) also floors — start-tile clusters need width', () => {
        expect(effectiveGatherLeash(10, 'None')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(8, 'none')).toBe(NAMED_CAMP_LEASH_FLOOR);
    });
});

describe('shouldYieldGathering', () => {
    test('a pending random event interrupts an active gather loop', () => {
        expect(shouldYieldGathering(true, false, false, false)).toBe(true);
    });

    test('an uninterrupted gather loop keeps waiting', () => {
        expect(shouldYieldGathering(false, false, false, false)).toBe(false);
    });

    test('existing full-pack, dialog, and missing-target exits remain intact', () => {
        expect(shouldYieldGathering(false, true, false, false)).toBe(true);
        expect(shouldYieldGathering(false, false, true, false)).toBe(true);
        expect(shouldYieldGathering(false, false, false, true)).toBe(true);
    });

    test('combat yields so river troll / swarm can be handled', () => {
        expect(shouldYieldGathering(false, false, false, false, true)).toBe(true);
        expect(shouldYieldGathering(false, false, false, false, false)).toBe(false);
    });
});

describe('fishingSessionBroken', () => {
    const calm = {
        eventPending: false,
        inventoryFull: false,
        dialogPending: false,
        inCombat: false,
        spotGone: false,
        spotMoved: false,
        becameWhirlpool: false
    };

    test('calm session keeps fishing', () => {
        expect(fishingSessionBroken(calm)).toBe(false);
    });

    test('spot hop ends the session even while animating', () => {
        expect(fishingSessionBroken({ ...calm, spotMoved: true })).toBe(true);
    });

    test('whirlpool swap ends the session', () => {
        expect(fishingSessionBroken({ ...calm, becameWhirlpool: true })).toBe(true);
    });

    test('spot despawn ends the session', () => {
        expect(fishingSessionBroken({ ...calm, spotGone: true })).toBe(true);
    });

    test('combat / event / full pack / dialog all break', () => {
        expect(fishingSessionBroken({ ...calm, inCombat: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, eventPending: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, inventoryFull: true })).toBe(true);
        expect(fishingSessionBroken({ ...calm, dialogPending: true })).toBe(true);
    });
});
