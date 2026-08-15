import { describe, expect, test } from 'bun:test';
import {
    BATCH,
    CUSTOM,
    HERB_OPTIONS,
    HERBS,
    SECONDARIES,
    SECONDARY_OPTIONS,
    VIAL_OF_WATER_ID,
    herbByName,
    secondaryByName
} from '#/bot/scripts/PotionMaker/PotionMakerLogic.js';

describe('herb table — a known row per clean/unfinished id', () => {
    test('every entry has distinct ids', () => {
        const ids = new Set(HERBS.map(h => h.id));
        const unfIds = new Set(HERBS.map(h => h.unfId));
        expect(ids.size).toBe(HERBS.length);
        expect(unfIds.size).toBe(HERBS.length);
    });

    test('unfinished ids differ from the water vial and every herb id', () => {
        for (const h of HERBS) {
            expect(h.unfId).not.toBe(VIAL_OF_WATER_ID);
            expect(h.unfId).not.toBe(h.id);
        }
    });

    test('the water vial is withdrawable apart from the batch size', () => {
        expect(VIAL_OF_WATER_ID).not.toBe(-1);
        expect(BATCH).toBeGreaterThanOrEqual(1);
    });

    test('HERB_OPTIONS carries every herb name for the settings UI', () => {
        expect(HERB_OPTIONS).toHaveLength(HERBS.length);
        expect(HERB_OPTIONS).toContain('Guam leaf');
        expect(HERB_OPTIONS).toContain('Torstol');
    });
});

describe('secondary table', () => {
    test('every entry has a distinct id', () => {
        const ids = new Set(SECONDARIES.map(s => s.id));
        expect(ids.size).toBe(SECONDARIES.length);
    });

    test('SECONDARY_OPTIONS carries every secondary name for the settings UI', () => {
        expect(SECONDARY_OPTIONS).toHaveLength(SECONDARIES.length);
        expect(SECONDARY_OPTIONS).toContain('Eye of newt');
        expect(SECONDARY_OPTIONS).toContain('Snape grass');
    });
});

describe('herbByName — custom text matching', () => {
    test('exact name, case-insensitive', () => {
        expect(herbByName('guam leaf')?.key).toBe('guam');
        expect(herbByName('GUAM LEAF')?.key).toBe('guam');
    });

    test('substring match', () => {
        expect(herbByName('ranarr')?.key).toBe('ranarr');
        expect(herbByName('torstol')?.name).toBe('Torstol');
    });

    test('unknown and blank names are null', () => {
        expect(herbByName('dragon stone')).toBeNull();
        expect(herbByName('  ')).toBeNull();
        expect(herbByName('')).toBeNull();
    });
});

describe('secondaryByName — custom text matching', () => {
    test('exact name, case-insensitive', () => {
        expect(secondaryByName('eye of newt')?.id).toBe(221);
        expect(secondaryByName("RED SPIDERS' EGGS")?.id).toBe(223);
    });

    test('substring match', () => {
        expect(secondaryByName('snape')?.name).toBe('Snape grass');
        expect(secondaryByName('zamorak')?.id).toBe(245);
    });

    test('unknown and blank names are null', () => {
        expect(secondaryByName('dragon claw')).toBeNull();
        expect(secondaryByName('')).toBeNull();
    });
});

describe('constants', () => {
    test('CUSTOM sentinel powers the reveal-a-text-field pattern', () => {
        expect(CUSTOM).toBe('Custom');
    });
});