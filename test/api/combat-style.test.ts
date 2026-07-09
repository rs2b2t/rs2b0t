import { expect, test } from 'bun:test';

import { COMBAT_STYLE_OPTIONS, parseCombatStyle } from '#/bot/api/CombatStyle.js';

test('parseCombatStyle maps each style (and its aliases) to its com_mode', () => {
    expect(parseCombatStyle('attack')).toBe(0);
    expect(parseCombatStyle('accurate')).toBe(0);
    expect(parseCombatStyle('strength')).toBe(1);
    expect(parseCombatStyle('aggressive')).toBe(1);
    expect(parseCombatStyle('defence')).toBe(2);
    expect(parseCombatStyle('defensive')).toBe(2);
});

test('parseCombatStyle is case/space-insensitive and defaults to strength (1)', () => {
    expect(parseCombatStyle('  Defence ')).toBe(2);
    expect(parseCombatStyle('STRENGTH')).toBe(1);
    expect(parseCombatStyle('nonsense')).toBe(1);
    expect(parseCombatStyle('')).toBe(1);
});

test('the dropdown offers one style per melee stat, all resolvable', () => {
    expect(COMBAT_STYLE_OPTIONS).toEqual(['attack', 'strength', 'defence']);
    for (const s of COMBAT_STYLE_OPTIONS) {
        expect([0, 1, 2]).toContain(parseCombatStyle(s));
    }
});
