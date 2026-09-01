import { describe, expect, test } from 'bun:test';
import {
    SAFESPOT_BLIND_MS,
    attackRangeFor,
    isClueObj,
    keyStatus,
    meleeShieldGate,
    nextSafespot,
    wantsDrop
} from '#/bot/scripts/JiveDragons/logic.js';

describe('nextSafespot', () => {
    const base = { index: 0, spots: 3, hurt: false, blindMs: 0 };

    test('holds the current tile while nothing is wrong', () => {
        expect(nextSafespot(base)).toBe(0);
    });

    test('a hit on the safespot rotates to the next tile', () => {
        expect(nextSafespot({ ...base, hurt: true })).toBe(1);
    });

    test('going blind for the full window rotates too', () => {
        expect(nextSafespot({ ...base, blindMs: SAFESPOT_BLIND_MS })).toBe(1);
        expect(nextSafespot({ ...base, blindMs: SAFESPOT_BLIND_MS - 1 })).toBe(0);
    });

    test('rotation wraps rather than running off the end', () => {
        expect(nextSafespot({ ...base, index: 2, hurt: true })).toBe(0);
    });

    test('a single-tile site never rotates', () => {
        expect(nextSafespot({ ...base, spots: 1, hurt: true })).toBe(0);
    });
});

describe('meleeShieldGate', () => {
    test('melee without the shield is refused, naming where to get one', () => {
        const why = meleeShieldGate('melee', false);
        expect(why).toContain('Duke Horacio');
    });

    test('melee with the shield passes', () => {
        expect(meleeShieldGate('melee', true)).toBeNull();
    });

    test('a safespot is fire-proof, so mage and range never need it', () => {
        expect(meleeShieldGate('mage', false)).toBeNull();
        expect(meleeShieldGate('range', false)).toBeNull();
    });
});

describe('attackRangeFor', () => {
    test('melee is adjacency, a bow is 7 and a staff is 10', () => {
        expect(attackRangeFor('melee')).toBe(1);
        expect(attackRangeFor('range')).toBe(7);
        expect(attackRangeFor('mage')).toBe(10);
    });
});

describe('keyStatus', () => {
    test('held beats banked beats a fetch', () => {
        expect(keyStatus(1, 3)).toBe('held');
        expect(keyStatus(0, 3)).toBe('bank');
        expect(keyStatus(0, 0)).toBe('fetch');
    });
});

describe('wantsDrop', () => {
    const filter = { loot: new Set(['dragonhide']), bankCommon: false, solveClues: false, buryBones: false, boneName: 'Dragon bones' };

    test('a ticked name is taken and an unticked one is left', () => {
        expect(wantsDrop({ id: 1753, name: 'Dragonhide' }, filter)).toBe(true);
        expect(wantsDrop({ id: 314, name: 'Feather' }, filter)).toBe(false);
    });

    test('unticking the bones box does not stop a burial run collecting them', () => {
        expect(wantsDrop({ id: 532, name: 'Dragon bones' }, filter)).toBe(false);
        expect(wantsDrop({ id: 532, name: 'Dragon bones' }, { ...filter, buryBones: true })).toBe(true);
    });

    test('clues are matched by id, since every hard trail displays the same name', () => {
        expect(isClueObj(2722)).toBe(true);
        expect(isClueObj(2714)).toBe(true);
        expect(isClueObj(995)).toBe(false);
        expect(wantsDrop({ id: 2722, name: 'Clue scroll' }, filter)).toBe(false);
        expect(wantsDrop({ id: 2722, name: 'Clue scroll' }, { ...filter, solveClues: true })).toBe(true);
    });

    test('the common-loot box takes a gem the loot list never mentions', () => {
        expect(wantsDrop({ id: 1623, name: 'Uncut sapphire' }, filter)).toBe(false);
        expect(wantsDrop({ id: 1623, name: 'Uncut sapphire' }, { ...filter, bankCommon: true })).toBe(true);
    });

    test('an unnamed ground item is never wanted', () => {
        expect(wantsDrop({ id: 4, name: null }, filter)).toBe(false);
    });
});
