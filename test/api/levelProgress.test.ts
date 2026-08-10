import { describe, expect, test } from 'bun:test';

import { etaHours, levelProgress, xpAtLevel } from '#/bot/api/hud/levelProgress.js';

describe('xpAtLevel', () => {
    // Pinned against the published curve — a generated table is only trustworthy
    // if its well-known values are asserted.
    test('matches the known experience table', () => {
        expect(xpAtLevel(1)).toBe(0);
        expect(xpAtLevel(2)).toBe(83);
        expect(xpAtLevel(10)).toBe(1154);
        expect(xpAtLevel(50)).toBe(101_333);
        expect(xpAtLevel(70)).toBe(737_627);
        expect(xpAtLevel(92)).toBe(6_517_253);
        expect(xpAtLevel(99)).toBe(13_034_431);
    });

    test('99 is half of 92, the usual sanity check', () => {
        expect(Math.round(xpAtLevel(99) / xpAtLevel(92))).toBe(2);
    });

    test('clamps out-of-range levels rather than returning undefined', () => {
        expect(xpAtLevel(0)).toBe(0);
        expect(xpAtLevel(200)).toBe(xpAtLevel(99));
    });
});

describe('levelProgress', () => {
    test('reports the gap to the next level', () => {
        const p = levelProgress(70, xpAtLevel(70));
        expect(p.fraction).toBe(0);
        expect(p.remaining).toBe(xpAtLevel(71) - xpAtLevel(70));
    });

    test('halfway through a level reads as a half bar', () => {
        const mid = (xpAtLevel(70) + xpAtLevel(71)) / 2;
        expect(levelProgress(70, mid).fraction).toBeCloseTo(0.5, 5);
    });

    test('99 is complete and needs nothing', () => {
        expect(levelProgress(99, xpAtLevel(99))).toEqual({ level: 99, fraction: 1, remaining: 0 });
    });

    test('xp below the level floor does not go negative', () => {
        expect(levelProgress(70, 0).fraction).toBe(0);
    });
});

describe('etaHours', () => {
    test('divides the gap by the rate', () => {
        expect(etaHours(100_000, 50_000)).toBe(2);
    });

    test('is null when stalled or already there', () => {
        expect(etaHours(100_000, 0)).toBeNull();
        expect(etaHours(0, 50_000)).toBeNull();
    });
});
