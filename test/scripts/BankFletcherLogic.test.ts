import { describe, expect, test } from 'bun:test';
import { attachPlanFor, LOG_OPTIONS, logNameMatches, matchProduct, productKeywords, productNeedsDifferentLog } from '#/bot/scripts/BankFletcherLogic.js';

describe('logNameMatches — exact, never substring (the maple-shortbow bug)', () => {
    test('"Logs" matches only regular Logs, NOT Maple/Yew/Oak logs', () => {
        expect(logNameMatches('Logs', 'Logs')).toBe(true);
        expect(logNameMatches('Maple logs', 'Logs')).toBe(false);
        expect(logNameMatches('Oak logs', 'Logs')).toBe(false);
        expect(logNameMatches('Yew logs', 'Logs')).toBe(false);
    });
    test('a qualified log matches only itself', () => {
        expect(logNameMatches('Maple logs', 'Maple logs')).toBe(true);
        expect(logNameMatches('Logs', 'Maple logs')).toBe(false);
        expect(logNameMatches('Yew logs', 'Maple logs')).toBe(false);
    });
    test('case- and whitespace-insensitive', () => {
        expect(logNameMatches('maple logs', 'Maple logs')).toBe(true);
        expect(logNameMatches('  Willow logs ', 'Willow logs')).toBe(true);
    });
    test('null/undefined names never match', () => {
        expect(logNameMatches(null, 'Logs')).toBe(false);
        expect(logNameMatches(undefined, 'Logs')).toBe(false);
    });
});

describe('productNeedsDifferentLog — arrow shafts need regular Logs', () => {
    test('arrow shafts + a non-regular log is refused', () => {
        expect(productNeedsDifferentLog('Arrow shafts', 'Maple logs')).toBe(true);
        expect(productNeedsDifferentLog('Arrow shafts', 'Oak logs')).toBe(true);
    });
    test('arrow shafts + regular Logs is fine', () => {
        expect(productNeedsDifferentLog('Arrow shafts', 'Logs')).toBe(false);
    });
    test('bows fletch from any log', () => {
        expect(productNeedsDifferentLog('Short bow', 'Maple logs')).toBe(false);
        expect(productNeedsDifferentLog('Long bow', 'Yew logs')).toBe(false);
    });
});

describe('LOG_OPTIONS', () => {
    test('regular Logs is the first (default) option and the qualified logs are present', () => {
        expect(LOG_OPTIONS[0]).toBe('Logs');
        expect(LOG_OPTIONS).toContain('Maple logs');
        expect(LOG_OPTIONS).toContain('Yew logs');
    });
});

describe('productKeywords', () => {
    test('known presets map to distinguishing keywords (case-insensitive)', () => {
        expect(productKeywords('Arrow shafts')).toEqual(['shaft', 'arrow']);
        expect(productKeywords('SHORT BOW')).toEqual(['short']);
        expect(productKeywords('  Long bow ')).toEqual(['long']);
    });

    test('an unknown product falls back to itself as one keyword', () => {
        expect(productKeywords('Willow shield')).toEqual(['willow shield']);
    });

    test('empty product yields no keywords', () => {
        expect(productKeywords('   ')).toEqual([]);
    });
});

describe('matchProduct — label-text menu form', () => {
    const labels = ['15 Arrow Shafts', 'Short Bow', 'Long Bow'];

    test('picks Arrow Shafts for the arrow-shafts preset', () => {
        expect(matchProduct(labels, 'Arrow shafts')).toBe('15 Arrow Shafts');
    });
    test('picks Short Bow, not Long Bow', () => {
        expect(matchProduct(labels, 'Short bow')).toBe('Short Bow');
    });
    test('picks Long Bow, not Short Bow', () => {
        expect(matchProduct(labels, 'Long bow')).toBe('Long Bow');
    });
});

describe('matchProduct — item-name menu form', () => {
    const names = ['Arrow shaft', 'Shortbow (u)', 'Longbow (u)'];

    test('shaft keyword matches the singular item name', () => {
        expect(matchProduct(names, 'Arrow shafts')).toBe('Arrow shaft');
    });
    test('short matches Shortbow (u)', () => {
        expect(matchProduct(names, 'Short bow')).toBe('Shortbow (u)');
    });
    test('long matches Longbow (u)', () => {
        expect(matchProduct(names, 'Long bow')).toBe('Longbow (u)');
    });
});

describe('matchProduct — edge cases', () => {
    test('returns null when no option matches', () => {
        expect(matchProduct(['Oak shortbow (u)'], 'Long bow')).toBeNull();
    });
    test('returns null on an empty menu', () => {
        expect(matchProduct([], 'Arrow shafts')).toBeNull();
    });
    test('returns the first matching option when several qualify', () => {
        expect(matchProduct(['Short bow', 'Shortbow (u)'], 'Short bow')).toBe('Short bow');
    });
});

describe('attachPlanFor', () => {
    test('headless arrows: feather onto shaft, level 1', () => {
        expect(attachPlanFor('Headless arrows')).toEqual({ inputs: ['Feather', 'Arrow shaft'], product: 'Headless arrow', level: 1 });
    });

    test('every tier resolves with the engine table levels', () => {
        const levels: Record<string, number> = { Bronze: 1, Iron: 15, Steel: 30, Mithril: 45, Adamant: 60, Rune: 75 };
        for (const [metal, level] of Object.entries(levels)) {
            const plan = attachPlanFor(`${metal} arrows`)!;
            expect(plan.inputs, metal).toEqual([`${metal} arrowtips`, 'Headless arrow']);
            expect(plan.product, metal).toBe(`${metal} arrow`);
            expect(plan.level, metal).toBe(level);
        }
    });

    test('knife products and unknowns resolve to null', () => {
        for (const p of ['Arrow shafts', 'Short bow', 'Long bow', 'Ogre arrows', '']) {
            expect(attachPlanFor(p), p).toBeNull();
        }
    });
});
