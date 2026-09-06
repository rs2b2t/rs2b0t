import { describe, expect, test } from 'bun:test';
import {
    NAMED_CAMP_LEASH_FLOOR,
    effectiveGatherLeash,
    gatherHuntRadius,
    gatherSpotRangeOrigin,
    isAutoLocation,
    resourceWithinCamp,
    spotAvoided,
    spotWithinGatherRange,
    sweepStopFor
} from '#/bot/scripts/GatheringBot/GatherCamp.js';
import { DEFAULT_CHASE_RADIUS, resolveCampRadius } from '#/bot/data/gatheringLocations.js';
import { HOME_ARRIVE_RADIUS, shouldSoftHomeFromGatherMiss, shouldWalkHomeToGatherAnchor } from '#/bot/api/tasks/Anchor.js';
import Tile from '#/bot/geometry/Tile.js';

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

describe('avoided spots', () => {
    // Why: the four Shilo tiles whose only stand is across the water, derived by tools/nav/shilo-fishing-stands.ts.
    const FAR = [
        { x: 2850, z: 2976, level: 0 },
        { x: 2855, z: 2977, level: 0 },
        { x: 2860, z: 2976, level: 0 },
        { x: 2869, z: 2977, level: 0 }
    ];

    test('a spot on a far-bank tile is refused however close it looks', () => {
        expect(spotAvoided({ x: 2855, z: 2977, level: 0 }, FAR)).toBe(true);
    });

    test('the village-bank tile one step from it is still fished', () => {
        expect(spotAvoided({ x: 2855, z: 2973, level: 0 }, FAR)).toBe(false);
        expect(spotAvoided({ x: 2856, z: 2977, level: 0 }, FAR)).toBe(false);
    });

    test('the same tile on another plane is a different tile', () => {
        expect(spotAvoided({ x: 2850, z: 2976, level: 1 }, FAR)).toBe(false);
    });

    test('a camp with no list refuses nothing', () => {
        expect(spotAvoided({ x: 2850, z: 2976, level: 0 }, [])).toBe(false);
    });
});

describe('the sweep', () => {
    const SWEEP = [
        { x: 2862, z: 2971, level: 0 },
        { x: 2856, z: 2972, level: 0 },
        { x: 2841, z: 2970, level: 0 },
        { x: 2836, z: 2970, level: 0 },
        { x: 2822, z: 2968, level: 0 }
    ];

    test('a camp with no sweep holds its pin', () => {
        expect(sweepStopFor([], 0, { x: 2841, z: 2970, level: 0 })).toEqual({ stop: null, index: 0 });
    });

    test('heads for the current stop while it is still away from it', () => {
        expect(sweepStopFor(SWEEP, 0, { x: 2841, z: 2970, level: 0 })).toEqual({ stop: SWEEP[0]!, index: 0 });
    });

    // Why: arriving with nothing in view is what says the stop is spent; measuring off anything else leaves the bot walking to the tile it stands on.
    test('advances once it is standing on the stop, and counts a neighbouring tile as arrived', () => {
        expect(sweepStopFor(SWEEP, 0, { x: 2862, z: 2971, level: 0 })).toEqual({ stop: SWEEP[1]!, index: 1 });
        expect(sweepStopFor(SWEEP, 0, { x: 2863, z: 2972, level: 0 })).toEqual({ stop: SWEEP[1]!, index: 1 });
    });

    test('wraps at the west end rather than turning, so a spot behind the bot is reached on the way round', () => {
        expect(sweepStopFor(SWEEP, 4, { x: 2822, z: 2968, level: 0 })).toEqual({ stop: SWEEP[0]!, index: 0 });
    });

    test('an index past the end and a missing player tile both resolve rather than throwing', () => {
        expect(sweepStopFor(SWEEP, 7, null)).toEqual({ stop: SWEEP[2]!, index: 2 });
        expect(sweepStopFor(SWEEP, 0, null)).toEqual({ stop: SWEEP[0]!, index: 0 });
    });

    test('a stop underfoot on another plane is not arrival', () => {
        expect(sweepStopFor(SWEEP, 0, { x: 2862, z: 2971, level: 1 })).toEqual({ stop: SWEEP[0]!, index: 0 });
    });
});
