import { describe, expect, test } from 'bun:test';
import {
    NAMED_CAMP_LEASH_FLOOR,
    effectiveGatherLeash,
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    isAutoLocation,
    resourceWithinCamp,
    spotWithinGatherRange
} from '#/bot/api/GatherCamp.js';
import { DEFAULT_CHASE_RADIUS, resolveCampRadius } from '#/bot/api/GatheringLocations.js';
import { HOME_ARRIVE_RADIUS, shouldSoftHomeFromGatherMiss, shouldWalkHomeToGatherAnchor } from '#/bot/api/Anchor.js';
import Tile from '#/bot/api/Tile.js';

describe('GatherCamp membership', () => {
    test('resourceWithinCamp inclusive Chebyshev', () => {
        expect(resourceWithinCamp(64, NAMED_CAMP_LEASH_FLOOR)).toBe(true);
        expect(resourceWithinCamp(65, NAMED_CAMP_LEASH_FLOOR)).toBe(false);
        expect(resourceWithinCamp(72, 80)).toBe(true);
    });

    test('effectiveGatherLeash Auto vs named floor', () => {
        expect(effectiveGatherLeash(12, 'Auto')).toBe(12);
        expect(effectiveGatherLeash(10, 'Catherby')).toBe(NAMED_CAMP_LEASH_FLOOR);
        expect(isAutoLocation(' auto ')).toBe(true);
        expect(isAutoLocation('Dwarven Mine')).toBe(false);
    });

    test('gatherHuntRadius freeform pad', () => {
        expect(gatherHuntRadius(28)).toBe(52);
        expect(gatherHuntRadius(18)).toBe(48);
    });

    test('gatherSpotRangeOrigin named + freeform fish use player', () => {
        expect(gatherSpotRangeOrigin(true, true)).toBe('player');
        expect(gatherSpotRangeOrigin(false, true, true)).toBe('player');
        expect(gatherSpotRangeOrigin(false, true, false)).toBe('anchor');
        expect(spotWithinGatherRange(40, 40)).toBe(true);
    });

    test('resolveCampRadius default', () => {
        expect(resolveCampRadius(undefined)).toBe(64);
        expect(DEFAULT_CHASE_RADIUS).toBe(40);
    });
});

describe('Anchor soft-home', () => {
    test('Catherby bank needs walk (not full membership home)', () => {
        const bankDist = new Tile(2845, 3431, 0).distanceTo(new Tile(2809, 3441, 0));
        expect(bankDist).toBe(36);
        expect(shouldWalkHomeToGatherAnchor(bankDist)).toBe(true);
        expect(shouldWalkHomeToGatherAnchor(HOME_ARRIVE_RADIUS)).toBe(false);
        expect(shouldSoftHomeFromGatherMiss(36)).toBe(true);
        expect(shouldSoftHomeFromGatherMiss(12)).toBe(false);
    });
});
