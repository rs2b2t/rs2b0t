import { expect, test } from 'bun:test';
import { plantStrategy } from '#/bot/api/RandomEvents.js';

test('growing/ready strange plant (Pick op) -> pick', () => {
    expect(plantStrategy(['Pick'])).toBe('pick');
    expect(plantStrategy(['Pick', 'Examine'])).toBe('pick');
    expect(plantStrategy(['Take'])).toBe('pick');
});

test('hostile strange plant (Attack op, no Pick) -> evade', () => {
    expect(plantStrategy(['Attack'])).toBe('evade');
    expect(plantStrategy(['Attack', 'Examine'])).toBe('evade');
});

test('unknown/empty ops default to pick (keep trying, do not flee a non-attacker)', () => {
    expect(plantStrategy([])).toBe('pick');
    expect(plantStrategy(['Examine'])).toBe('pick');
});
