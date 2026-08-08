import { describe, expect, test } from 'bun:test';
import {
    CANNOT_IDENTIFY,
    HERB_OPTIONS,
    HERBS,
    eligibleHerbs,
    herbById,
    herbByCleanId,
    herbByUnidId
} from '#/bot/scripts/HerbCleanerLogic.js';

describe('eligibleHerbs — level boundaries and ordering', () => {
    test('every herb the player can identify is included, lowest level first', () => {
        const result = eligibleHerbs(99, []);
        expect(result.length).toBe(HERBS.length);
        for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].level).toBeLessThanOrEqual(result[i].level);
        }
    });

    test('exactly at the required level is enough', () => {
        const names = eligibleHerbs(25, []).map(h => h.name);
        expect(names).toContain('Ranarr weed');
        expect(names).not.toContain('Irit leaf');
    });

    test('just below the required level is excluded', () => {
        const names = eligibleHerbs(24, []).map(h => h.name);
        expect(names).not.toContain('Ranarr weed');
    });

    test('empty selection cleans every reachable herb', () => {
        expect(eligibleHerbs(99, [])).toHaveLength(HERBS.length);
    });

    test('a non-empty selection restricts to the named herbs, case-insensitively', () => {
        const result = eligibleHerbs(99, ['GUAM LEAF', 'ranarr weed']);
        expect(result.map(h => h.name)).toEqual(['Guam leaf', 'Ranarr weed']);
    });

    test('unknown selections add nothing', () => {
        expect(eligibleHerbs(99, ['Not a herb'])).toHaveLength(0);
    });
});

describe('herb table — a known row per unid and clean id, engine-verified levels', () => {
    test('every entry has distinct unique ids', () => {
        const unids = new Set(HERBS.map(h => h.unidId));
        const cleans = new Set(HERBS.map(h => h.id));
        expect(unids.size).toBe(HERBS.length);
        expect(cleans.size).toBe(HERBS.length);
    });

    test('engine-accurate levels: Snapdragon 59, Cadantine 65 (off-by-one regression)', () => {
        const snap = HERBS.find(h => h.key === 'snapdragon');
        const cad = HERBS.find(h => h.key === 'cadantine');
        expect(snap?.level).toBe(59);
        expect(cad?.level).toBe(65);
    });

    test('HERB_OPTIONS carries every herb name for the settings UI', () => {
        expect(HERB_OPTIONS).toHaveLength(HERBS.length);
        expect(HERB_OPTIONS).toContain('Snapdragon');
        expect(HERB_OPTIONS).toContain('Cadantine');
    });
});

describe('id lookups', () => {
    test('herbById finds either the clean or the unid id', () => {
        const guam = HERBS.find(h => h.key === 'guam')!;
        expect(herbById(guam.id)?.key).toBe('guam');
        expect(herbById(guam.unidId)?.key).toBe('guam');
    });

    test('herbByCleanId only matches the clean id', () => {
        const guam = HERBS.find(h => h.key === 'guam')!;
        expect(herbByCleanId(guam.id)?.key).toBe('guam');
        expect(herbByCleanId(guam.unidId)).toBeNull();
    });

    test('herbByUnidId only matches the unid id', () => {
        const guam = HERBS.find(h => h.key === 'guam')!;
        expect(herbByUnidId(guam.unidId)?.key).toBe('guam');
        expect(herbByUnidId(guam.id)).toBeNull();
    });

    test('unmatched ids and unknown herbs are null', () => {
        expect(herbById(-1)).toBeNull();
        expect(herbByCleanId(-1)).toBeNull();
        expect(herbByUnidId(-1)).toBeNull();
    });
});

describe('CANNOT_IDENTIFY — chat refusals the bot must react to', () => {
    test('matches the level-gate refusal', () => {
        expect(CANNOT_IDENTIFY.test('You cannot identify this herb.')).toBe(true);
    });

    test('matches the members-world refusal (pre-level members gate)', () => {
        expect(CANNOT_IDENTIFY.test("You need to be on a members' world to identify this herb.")).toBe(true);
    });

    test('does not match unrelated chat', () => {
        expect(CANNOT_IDENTIFY.test('You need a higher Herblore level for a potion.')).toBe(false);
        expect(CANNOT_IDENTIFY.test('Welcome to Old School RuneScape.')).toBe(false);
    });
});