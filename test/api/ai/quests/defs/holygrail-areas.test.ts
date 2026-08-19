import { describe, expect, test } from 'bun:test';

import {
    GRAIL_TILE,
    eastOfTitan,
    inBlightedRealm,
    inCastleUpstairs,
    inFisherRealm,
    inRenewedRealm
} from '#/bot/api/ai/quests/defs/holygrail/areas.js';

const at = (x: number, z: number, level = 0): { x: number; z: number; level: number } => ({ x, z, level });

describe('Holy Grail areas', () => {
    test('the two realms are distinct and both count as the Fisher realm', () => {
        expect(inBlightedRealm(GRAIL_TILE.REALM_ARRIVAL)).toBe(true);
        expect(inRenewedRealm(GRAIL_TILE.REALM_ARRIVAL)).toBe(false);
        expect(inRenewedRealm(GRAIL_TILE.RENEWED_ARRIVAL)).toBe(true);
        expect(inBlightedRealm(GRAIL_TILE.RENEWED_ARRIVAL)).toBe(false);
        expect(inFisherRealm(GRAIL_TILE.GRAIL_STAND)).toBe(true);
    });

    test('mainland tiles are in neither realm', () => {
        expect(inFisherRealm(GRAIL_TILE.SIX_HEADS)).toBe(false);
        expect(inFisherRealm(GRAIL_TILE.GOBLIN_SACKS)).toBe(false);
        expect(inFisherRealm(null)).toBe(false);
    });

    test('the whistle landing is on the titan side and his west tile is not', () => {
        expect(eastOfTitan(GRAIL_TILE.REALM_ARRIVAL)).toBe(true);
        expect(eastOfTitan(GRAIL_TILE.TITAN_STAND)).toBe(true);
        expect(eastOfTitan(GRAIL_TILE.TITAN_WEST)).toBe(false);
    });

    // Every pair is a row of the baked collision pack: the pocket's westmost tile
    // and the outside component's eastmost tile on the same z.
    test.each([
        [4709, 2805, 2796],
        [4710, 2801, 2792],
        [4711, 2799, 2791],
        [4712, 2797, 2790],
        [4713, 2794, 2790],
        [4716, 2793, 2789],
        [4722, 2792, 2790],
        [4725, 2792, 2788],
        [4728, 2790, 2784],
        [4731, 2789, 2783]
    ])('z %i splits the pocket at x %i from the far side at x %i', (z, pocketWest, outsideEast) => {
        expect(eastOfTitan(at(pocketWest, z))).toBe(true);
        expect(eastOfTitan(at(outsideEast, z))).toBe(false);
    });

    test('the castle side and the ground outside it are never confused by level', () => {
        expect(eastOfTitan(GRAIL_TILE.BELL_SPAWN)).toBe(false);
        expect(eastOfTitan(GRAIL_TILE.CASTLE_LANDING)).toBe(false);
        expect(inCastleUpstairs(GRAIL_TILE.FISHER_KING)).toBe(true);
        expect(inCastleUpstairs(GRAIL_TILE.CASTLE_LANDING)).toBe(false);
        expect(inCastleUpstairs(GRAIL_TILE.GRAIL_STAND)).toBe(false);
    });

    test('upper floors of the arrival pocket are not the titan side', () => {
        expect(eastOfTitan(at(GRAIL_TILE.REALM_ARRIVAL.x, GRAIL_TILE.REALM_ARRIVAL.z, 1))).toBe(false);
    });
});
