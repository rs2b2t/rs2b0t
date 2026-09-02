import { describe, expect, test } from 'bun:test';
import { SA_MAX_ENERGY, Special } from '#/bot/api/combat/Special.js';

describe('weapon specials', () => {
    test('a weapon without param=specwep has no cost', () => {
        expect(Special.cost('Rune scimitar')).toBeNull();
        expect(Special.cost('Staff of fire')).toBeNull();
        expect(Special.cost('')).toBeNull();
    });

    test('cost lookup ignores case and padding', () => {
        expect(Special.cost('Dragon dagger')).toBe(250);
        expect(Special.cost('  dragon DAGGER(p) ')).toBe(250);
        expect(Special.cost('Magic shortbow')).toBe(350);
        expect(Special.cost('Rune thrownaxe')).toBe(100);
    });

    test('every special is affordable on a full bar', () => {
        for (const weapon of ['Dragon dagger', 'Dragon halberd', 'Magic longbow', 'Rune claws']) {
            expect(Special.cost(weapon)!).toBeLessThanOrEqual(SA_MAX_ENERGY);
        }
    });
});
