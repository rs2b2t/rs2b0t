import { describe, expect, test } from 'bun:test';
import { DEFAULT_SPOTS, ROCKS_SPAWNS, spawnsWithin } from '#/bot/scripts/RockCrabSpots.js';

// The preset-spot contract: each default loc is a stand tile whose 3x3 square
// touches 2-3 dormant Rocks spawns (spawn within Chebyshev 2), spots sit on
// distinct clusters, and none stands on a spawn tile (the rock occupies it).

describe('DEFAULT_SPOTS', () => {
    test('provides 3-5 preset spots, loc1 = the user-verified (2704,3726)', () => {
        expect(DEFAULT_SPOTS.length).toBeGreaterThanOrEqual(3);
        expect(DEFAULT_SPOTS.length).toBeLessThanOrEqual(5);
        expect(DEFAULT_SPOTS[0].x).toBe(2704);
        expect(DEFAULT_SPOTS[0].z).toBe(3726);
    });

    test('every spot touches 2-3 spawns with its 3x3 square', () => {
        for (const spot of DEFAULT_SPOTS) {
            const touch = spawnsWithin(spot, 2);
            expect(touch).toBeGreaterThanOrEqual(2);
            expect(touch).toBeLessThanOrEqual(3);
        }
    });

    test('the top two spots wake 2 crabs from standing still (huntrange 1)', () => {
        expect(spawnsWithin(DEFAULT_SPOTS[0], 1)).toBe(2);
        expect(spawnsWithin(DEFAULT_SPOTS[1], 1)).toBe(2);
    });

    test('no spot stands on a spawn tile', () => {
        for (const spot of DEFAULT_SPOTS) {
            expect(ROCKS_SPAWNS.some(s => s.equals(spot))).toBe(false);
        }
    });

    test('spots are pairwise > 4 apart (one per cluster, rotation hits fresh crabs)', () => {
        for (let i = 0; i < DEFAULT_SPOTS.length; i++) {
            for (let j = i + 1; j < DEFAULT_SPOTS.length; j++) {
                expect(DEFAULT_SPOTS[i].distanceTo(DEFAULT_SPOTS[j])).toBeGreaterThan(4);
            }
        }
    });

    test('all spots and spawns share the field level (0) and bounding box', () => {
        for (const t of [...DEFAULT_SPOTS, ...ROCKS_SPAWNS]) {
            expect(t.level).toBe(0);
            expect(t.x).toBeGreaterThanOrEqual(2690);
            expect(t.x).toBeLessThanOrEqual(2723);
            expect(t.z).toBeGreaterThanOrEqual(3710);
            expect(t.z).toBeLessThanOrEqual(3733);
        }
    });
});
