import { describe, expect, test } from 'bun:test';
import { specialRequiresAt } from '#/bot/nav/v2/specialRequires.js';

describe('specialRequiresAt — guild skill gates (content-backed)', () => {
    test('Fishing Guild doors require fishing 68', () => {
        expect(specialRequiresAt(2611, 3394, 0)?.skills).toEqual([{ name: 'fishing', level: 68 }]);
        expect(specialRequiresAt(2611, 3398, 0)?.skills).toEqual([{ name: 'fishing', level: 68 }]);
    });

    test('Magic Guild doors require magic 66', () => {
        expect(specialRequiresAt(2584, 3087, 0)?.skills).toEqual([{ name: 'magic', level: 66 }]);
        expect(specialRequiresAt(2597, 3088, 0)?.skills).toEqual([{ name: 'magic', level: 66 }]);
    });

    test('Crafting Guild door requires crafting 40', () => {
        expect(specialRequiresAt(2933, 3289, 0)?.skills).toEqual([{ name: 'crafting', level: 40 }]);
    });

    test('Cooking Guild door requires cooking 32 (hat is execute-time)', () => {
        expect(specialRequiresAt(3143, 3444, 0)?.skills).toEqual([{ name: 'cooking', level: 32 }]);
    });

    test('Mining Guild ladder descent requires mining 60', () => {
        expect(specialRequiresAt(3019, 3339, 0)?.skills).toEqual([{ name: 'mining', level: 60 }]);
        expect(specialRequiresAt(3020, 3340, 0)?.skills).toEqual([{ name: 'mining', level: 60 }]);
        // exit from cellar has no gate
        expect(specialRequiresAt(3019, 9739, 0)).toBeUndefined();
    });

    test('unrelated tile has no gate', () => {
        expect(specialRequiresAt(3200, 3200, 0)).toBeUndefined();
    });
});
