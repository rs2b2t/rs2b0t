import { describe, expect, test } from 'bun:test';
import {
    COOKING_RANGE_LOCS,
    chebyshev,
    cookSurfaceForFishCamp,
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
        expect(bank?.stand.x).toBe(2715);
        expect(bank?.stand.z).toBe(3475);
        expect(bank?.approach).toBeUndefined();
        expect(bank?.label).toMatch(/village|bank/i);
    });

    test('resolveFishCampCookSurface prefers curated then nearest', () => {
        const c = resolveFishCampCookSurface('Catherby', { x: 2845, z: 3431, level: 0 });
        expect(c?.stand.x).toBe(2817);
        const free = resolveFishCampCookSurface(null, { x: 2817, z: 3444, level: 0 }, 8);
        expect(free?.kind).toBe('range');
    });
});
