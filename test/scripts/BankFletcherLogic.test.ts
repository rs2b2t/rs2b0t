import { describe, expect, test } from 'bun:test';
import { attachPlanFor, matchProduct, productKeywords } from '#/bot/scripts/BankFletcherLogic.js';

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
        // both contain "short"; the first wins so the largest-qty button is stable
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
            expect(plan.inputs, metal).toEqual([`${metal} arrowtips`, 'Headless arrow']); // display name is 'arrowtips', not 'arrowheads' (arrows.obj)
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
