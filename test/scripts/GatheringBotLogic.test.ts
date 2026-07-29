import { describe, expect, test } from 'bun:test';
import {
    HOME_ARRIVE_RADIUS,
    NAMED_CAMP_LEASH_FLOOR,
    effectiveGatherLeash,
    fishingSessionBroken,
    gatherHuntRadius,
    isAutoLocation,
    shouldYieldGathering
} from '#/bot/scripts/GatheringBot.js';
import { AXE_BAR_FOR } from '#/bot/scripts/ToolAcquire.js';
import Tile from '#/bot/api/Tile.js';

describe('HOME_ARRIVE_RADIUS (soft home after bank/shop)', () => {
    test('is a camp disk, not a single pin tile', () => {
        expect(HOME_ARRIVE_RADIUS).toBe(8);
        const anchor = new Tile(2845, 3431, 0);
        // Inside disk → walkHomeIfNeeded short-circuits (no robotic pin).
        expect(anchor.distanceTo(new Tile(2845 + 8, 3431, 0))).toBe(8);
        expect(anchor.distanceTo(new Tile(2845 + 9, 3431, 0))).toBe(9);
    });
});

describe('effectiveGatherLeash', () => {
    test('Auto keeps the UI setting (freeform / unverified snaps)', () => {
        expect(effectiveGatherLeash(12, 'Auto')).toBe(12);
        expect(effectiveGatherLeash(18, 'auto')).toBe(18);
        expect(effectiveGatherLeash(40, 'Auto')).toBe(40);
        expect(effectiveGatherLeash(64, 'Auto')).toBe(64);
    });

    test('named camps floor to NAMED_CAMP_LEASH_FLOOR (Fishing Guild / Catherby-scale)', () => {
        expect(effectiveGatherLeash(10, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(18, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(12, 'Southwest Varrock Mine')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(18, 'Fishing Guild')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(40, 'Draynor Village')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(64, 'Draynor Village')).toBe(64);
    });

    test('None (power) also floors — start-tile clusters need width', () => {
        expect(effectiveGatherLeash(10, 'None')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(effectiveGatherLeash(8, 'none')).toBe(NAMED_CAMP_LEASH_FLOOR);
    });
});

describe('isAutoLocation', () => {
    test('only Auto is expert freeform (no mob flee)', () => {
        expect(isAutoLocation('Auto')).toBe(true);
        expect(isAutoLocation(' auto ')).toBe(true);
        expect(isAutoLocation('Fishing Guild')).toBe(false);
        expect(isAutoLocation('None')).toBe(false);
    });
});

describe('gatherHuntRadius', () => {
    test('extends past leash without a hard 40 cap', () => {
        expect(gatherHuntRadius(18)).toBe(30);
        expect(gatherHuntRadius(40)).toBe(52);
        expect(gatherHuntRadius(NAMED_CAMP_LEASH_FLOOR)).toBeGreaterThan(NAMED_CAMP_LEASH_FLOOR);
        expect(gatherHuntRadius(NAMED_CAMP_LEASH_FLOOR)).toBe(NAMED_CAMP_LEASH_FLOOR + 12);
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

describe('AXE_BAR_FOR (smith restock keep)', () => {
    test('maps every smithable axe to a bar name restock must retain', () => {
        expect(AXE_BAR_FOR['Rune axe']).toBe('Runite bar');
        expect(AXE_BAR_FOR['Mithril axe']).toBe('Mithril bar');
        expect(Object.values(AXE_BAR_FOR).length).toBeGreaterThanOrEqual(6);
        expect(new Set(Object.values(AXE_BAR_FOR)).has('Runite bar')).toBe(true);
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
