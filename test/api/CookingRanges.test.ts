import { describe, expect, test } from 'bun:test';
import {
    COOKING_RANGE_LOCS,
    chebyshev,
    cookSurfaceForFishCamp,
    listFishCampRangePathCases,
    nearestCookingRange,
    rangeStandFromLoc,
    resolveFishCampCookSurface
} from '#/bot/api/CookingRanges.js';

describe('CookingRanges catalog', () => {
    test('map pack yielded many Range ovens', () => {
        expect(COOKING_RANGE_LOCS.length).toBeGreaterThan(40);
        // Catherby bank-house range (known cook loop).
        expect(COOKING_RANGE_LOCS.some(r => r.x === 2817 && r.z === 3444 && r.level === 0)).toBe(true);
    });

    test('stand is one tile south of loc SW', () => {
        const s = rangeStandFromLoc({ x: 2817, z: 3444, level: 0 });
        expect(s.x).toBe(2817);
        expect(s.z).toBe(3443);
        expect(s.level).toBe(0);
    });

    test('nearestCookingRange finds Catherby oven from the pier', () => {
        const near = nearestCookingRange({ x: 2845, z: 3431, level: 0 }, 64);
        expect(near).not.toBeNull();
        expect(near!.kind).toBe('range');
        expect(near!.locName).toBe('Range');
        expect(chebyshev({ x: 2845, z: 3431 }, near!.loc!)).toBeLessThanOrEqual(40);
    });

    test('curated fish-camp surfaces cover cook-capable camps', () => {
        expect(cookSurfaceForFishCamp('Catherby')?.locName).toBe('Range');
        expect(cookSurfaceForFishCamp('Seers (fly fishing)')?.locName).toBe('Range');
        expect(cookSurfaceForFishCamp('Barbarian Village')?.locName).toBe('Fire');
        expect(cookSurfaceForFishCamp('Draynor Village')?.locName).toBe('Fireplace');
        expect(cookSurfaceForFishCamp('Fishing Guild')?.locName).toBe('Range');
    });

    test('Seers pier uses Large-door approach then interior stand; bank role uses village range', () => {
        const pier = cookSurfaceForFishCamp('Seers (fly fishing)', 'pier');
        expect(pier?.approach?.x).toBe(2740);
        expect(pier?.approach?.z).toBe(3570);
        expect(pier?.stand.x).toBe(2735);
        expect(pier?.stand.z).toBe(3581);
        const bank = cookSurfaceForFishCamp('Seers (fly fishing)', 'bank');
        // Interior north of range via Door@2713,3483 (south street stand is unusable).
        expect(bank?.approach?.x).toBe(2713);
        expect(bank?.approach?.z).toBe(3484);
        expect(bank?.stand.x).toBe(2716);
        expect(bank?.stand.z).toBe(3477);
        expect(bank?.label).toMatch(/village|bank/i);
    });

    test('Draynor fireplace uses east-door approach and interior stand', () => {
        const pier = cookSurfaceForFishCamp('Draynor Village', 'pier');
        expect(pier?.approach?.x).toBe(3102);
        expect(pier?.approach?.z).toBe(3258);
        expect(pier?.stand.x).toBe(3100);
        expect(pier?.stand.z).toBe(3257);
        expect(pier?.locName).toBe('Fireplace');
    });

    test('resolveFishCampCookSurface prefers curated then nearest', () => {
        const c = resolveFishCampCookSurface('Catherby', { x: 2845, z: 3431, level: 0 });
        expect(c?.stand.x).toBe(2817);
        const free = resolveFishCampCookSurface(null, { x: 2817, z: 3444, level: 0 }, 8);
        expect(free?.kind).toBe('range');
    });

    test('listFishCampRangePathCases covers every plan (pier + distinct bank)', () => {
        const cases = listFishCampRangePathCases();
        const ids = cases.map(c => c.id);
        expect(ids).toContain('range-path-catherby-pier');
        expect(ids).toContain('range-path-seers-fly-fishing-pier');
        expect(ids).toContain('range-path-seers-fly-fishing-bank');
        expect(ids).toContain('range-path-barbarian-village-pier');
        expect(ids).toContain('range-path-draynor-village-pier');
        expect(ids).toContain('range-path-fishing-guild-pier');
        // Catherby pier===bank → only one case
        expect(ids.filter(i => i.includes('catherby'))).toHaveLength(1);
        expect(cases.length).toBeGreaterThanOrEqual(6);
    });
});
