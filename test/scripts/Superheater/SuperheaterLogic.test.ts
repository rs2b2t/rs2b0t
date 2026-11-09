import { describe, expect, test } from 'bun:test';
import { STAFF_RUNES } from '#/bot/data/spelldb.js';
import {
    FIRE_STAFF,
    FIRE_STAVES,
    opIndex,
    pickFireStaff,
    wantsGoldsmithGauntlets,
    withdrawSet,
    recipeForBar
} from '#/bot/scripts/Superheater/SuperheaterLogic.js';

const fireProviders = Object.entries(STAFF_RUNES)
    .filter(([, runes]) => runes.some(r => r.toLowerCase() === 'fire rune'))
    .map(([staff]) => staff);

describe('FIRE_STAVES', () => {
    test('Staff of fire is first so a bank that has both keeps the old withdraw', () => {
        expect(FIRE_STAVES[0]).toBe(FIRE_STAFF);
        expect(FIRE_STAFF).toBe('Staff of fire');
    });

    test('covers every STAFF_RUNES entry that substitutes a fire rune', () => {
        expect([...FIRE_STAVES].sort()).toEqual([...fireProviders].sort());
        expect(FIRE_STAVES).toContain('Fire battlestaff');
        expect(FIRE_STAVES).toContain('Lava battlestaff');
        expect(FIRE_STAVES).toContain('Mystic fire staff');
        expect(FIRE_STAVES).toContain('Mystic lava staff');
    });

    test('does not include air or water staves', () => {
        expect(FIRE_STAVES).not.toContain('Staff of air');
        expect(FIRE_STAVES).not.toContain('Water battlestaff');
    });
});

describe('pickFireStaff', () => {
    test('returns undefined when none of the fire staves are present', () => {
        expect(pickFireStaff(() => false)).toBeUndefined();
        expect(pickFireStaff(name => name === 'Staff of air')).toBeUndefined();
    });

    test('accepts a Fire battlestaff on its own, which is also the already-wielded case', () => {
        expect(pickFireStaff(name => name === 'Fire battlestaff')).toBe('Fire battlestaff');
    });

    test('prefers Staff of fire when the bank also holds a battlestaff', () => {
        const bank = new Set(['Fire battlestaff', 'Staff of fire']);
        expect(pickFireStaff(name => bank.has(name))).toBe('Staff of fire');
    });

    test('accepts mystic and lava fire staves', () => {
        expect(pickFireStaff(name => name === 'Mystic fire staff')).toBe('Mystic fire staff');
        expect(pickFireStaff(name => name === 'Lava battlestaff')).toBe('Lava battlestaff');
    });
});

describe('wantsGoldsmithGauntlets', () => {
    test('only gold, and only while the toggle is on', () => {
        expect(wantsGoldsmithGauntlets('Gold', true)).toBe(true);
        expect(wantsGoldsmithGauntlets('gold', true)).toBe(true);
        expect(wantsGoldsmithGauntlets(' Gold ', true)).toBe(true);
        expect(wantsGoldsmithGauntlets('Gold', false)).toBe(false);
        expect(wantsGoldsmithGauntlets('Steel', true)).toBe(false);
        expect(wantsGoldsmithGauntlets('Iron', true)).toBe(false);
    });
});

describe('gold withdraw plan', () => {
    test('one gold ore per bar, 27 slots per trip', () => {
        const gold = recipeForBar('Gold');
        expect(gold).toBeDefined();
        expect(withdrawSet(gold!)).toEqual({ 'Gold ore': 27 });
    });
});

describe('opIndex', () => {
    test('is 1-based, skips nulls and reports -1 on no match', () => {
        expect(opIndex([null, 'Withdraw-All'], /withdraw[\s-]*all/i)).toBe(2);
        expect(opIndex(['Deposit-All', 'Deposit-X'], /deposit[\s-]*all/i)).toBe(1);
        expect(opIndex(['Withdraw-1', null], /withdraw[\s-]*all/i)).toBe(-1);
        expect(opIndex([], /anything/)).toBe(-1);
    });
});
