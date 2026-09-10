import { describe, expect, test } from 'bun:test';
import { bestMeleeWeapon, knownMeleeWeapon } from '#/bot/api/combat/meleeWeapons.js';

describe('bestMeleeWeapon', () => {
    const bank = ['Rune scimitar', 'Dragon longsword', 'Rune sword', 'Adamant scimitar', 'Shark', 'Dragon dagger(p)'];

    test('the highest tier wins, and stab first for a target soft to stab', () => {
        expect(bestMeleeWeapon(bank, { attack: 99, preferStab: true })).toBe('Dragon longsword');
    });

    test('the scimitar leads its tier elsewhere', () => {
        expect(bestMeleeWeapon(['Rune scimitar', 'Rune longsword', 'Rune sword'], { attack: 99, preferStab: false })).toBe('Rune scimitar');
        expect(bestMeleeWeapon(['Rune longsword', 'Rune sword'], { attack: 99, preferStab: false })).toBe('Rune sword');
    });

    test('a tier above the Attack level is skipped', () => {
        expect(bestMeleeWeapon(bank, { attack: 59, preferStab: true })).toBe('Rune sword');
        expect(bestMeleeWeapon(bank, { attack: 39, preferStab: true })).toBe('Adamant scimitar');
    });

    test('a weapon a wield refused is skipped, whatever its tier', () => {
        expect(bestMeleeWeapon(bank, { attack: 99, preferStab: true, unusable: new Set(['Dragon longsword']) })).toBe('Dragon dagger(p)');
    });

    test('names match whatever their case, and nothing wieldable is null', () => {
        expect(bestMeleeWeapon(['rune scimitar'], { attack: 99, preferStab: false })).toBe('Rune scimitar');
        expect(bestMeleeWeapon(['Shark', 'Coins'], { attack: 99, preferStab: false })).toBeNull();
    });
});

describe('knownMeleeWeapon', () => {
    test('finds the one melee weapon in a worn list', () => {
        expect(knownMeleeWeapon(['Rune full helm', 'Rune scimitar', 'Dragonfire shield'])).toBe('Rune scimitar');
        expect(knownMeleeWeapon(['Rune full helm'])).toBeNull();
    });
});
