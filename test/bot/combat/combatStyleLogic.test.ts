import { describe, expect, test } from 'bun:test';
import { castsAvailable, runeWithdrawList, runesPerCast, spellButtonCom } from '#/bot/api/combat/CombatStyleLogic.js';

describe('runesPerCast', () => {
    test('no staff → full cost', () => {
        expect(runesPerCast('Wind Strike', [])).toEqual([
            { rune: 'Mind rune', count: 1 },
            { rune: 'Air rune', count: 1 }
        ]);
    });

    test('matching staff zeroes its element (Staff of fire + Fire Strike)', () => {
        expect(runesPerCast('Fire Strike', ['Staff of fire'])).toEqual([
            { rune: 'Mind rune', count: 1 },
            { rune: 'Air rune', count: 2 }
        ]);
    });

    test('staff of air kills the air cost on every spell', () => {
        expect(runesPerCast('Fire Blast', ['Staff of air'])).toEqual([
            { rune: 'Death rune', count: 1 },
            { rune: 'Fire rune', count: 5 }
        ]);
    });

    test('lava battlestaff provides BOTH earth and fire', () => {
        expect(runesPerCast('Earth Blast', ['Lava battlestaff'])).toEqual([
            { rune: 'Death rune', count: 1 },
            { rune: 'Air rune', count: 3 }
        ]);
        expect(runesPerCast('Fire Blast', ['Lava battlestaff'])).toEqual([
            { rune: 'Death rune', count: 1 },
            { rune: 'Air rune', count: 4 }
        ]);
    });

    test('non-elemental weapon → full cost; unknown spell → null', () => {
        expect(runesPerCast('Wind Strike', ['Bronze sword'])).toEqual([
            { rune: 'Mind rune', count: 1 },
            { rune: 'Air rune', count: 1 }
        ]);
        expect(runesPerCast('Confuse', [])).toBeNull();
    });

    test('spell name matching is case-insensitive', () => {
        expect(runesPerCast('fire strike', ['staff of fire'])).toEqual([
            { rune: 'Mind rune', count: 1 },
            { rune: 'Air rune', count: 2 }
        ]);
    });
});

describe('spellButtonCom', () => {
    test('ssb index maps to staff_spells com id (1830 + ssb)', () => {
        expect(spellButtonCom('Wind Strike')).toBe(1830);
        expect(spellButtonCom('Fire Wave')).toBe(1845);
        expect(spellButtonCom('nope')).toBe(-1);
    });
});

describe('castsAvailable', () => {
    test('limited by the scarcest rune', () => {
        const held = { 'Mind rune': 100, 'Air rune': 7 };
        expect(castsAvailable('Fire Strike', ['Staff of fire'], name => held[name as keyof typeof held] ?? 0)).toBe(3); // 7 air / 2 per cast
    });

    test('zero when a rune is absent; staff makes a mono-rune spell castable', () => {
        expect(castsAvailable('Wind Strike', ['Staff of air'], () => 0)).toBe(0); // still needs minds
        expect(castsAvailable('Wind Strike', ['Staff of air'], name => (name === 'Mind rune' ? 5 : 0))).toBe(5);
    });
});

describe('runeWithdrawList', () => {
    test('scales per-cast costs by the requested casts', () => {
        expect(runeWithdrawList('Fire Strike', ['Staff of fire'], 100)).toEqual([
            { rune: 'Mind rune', count: 100 },
            { rune: 'Air rune', count: 200 }
        ]);
    });
});
