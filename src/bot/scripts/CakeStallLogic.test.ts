import { expect, test, describe } from 'bun:test';

import { classifySteal, shouldReset, RESET_AFTER_REFUSALS, STAND, RESET_TILE, CAKE_ITEMS } from './CakeStallLogic.js';

describe('classifySteal (one steal click resolved)', () => {
    test('a gained cake is success even if ambient combat coincides', () => {
        expect(classifySteal({ gained: true, combat: false, lockoutSeen: false, attemptSeen: true })).toBe('success');
        expect(classifySteal({ gained: true, combat: true, lockoutSeen: false, attemptSeen: true })).toBe('success');
    });

    test('combat without a cake = a guard caught the theft', () => {
        expect(classifySteal({ gained: false, combat: true, lockoutSeen: false, attemptSeen: true })).toBe('caught');
    });

    test('the engine lockout message wins over a bare refusal', () => {
        expect(classifySteal({ gained: false, combat: false, lockoutSeen: true, attemptSeen: true })).toBe('lockout');
    });

    test('attempt seen but nothing landed = Baker refusal (his npc_say is overhead-only)', () => {
        expect(classifySteal({ gained: false, combat: false, lockoutSeen: false, attemptSeen: true })).toBe('refused');
    });

    test('no signals at all = the click never registered', () => {
        expect(classifySteal({ gained: false, combat: false, lockoutSeen: false, attemptSeen: false })).toBe('timeout');
    });
});

describe('shouldReset (refusal streak -> walk off and let the Baker drift)', () => {
    test('resets at the threshold, not before', () => {
        expect(shouldReset(RESET_AFTER_REFUSALS - 1)).toBe(false);
        expect(shouldReset(RESET_AFTER_REFUSALS)).toBe(true);
        expect(shouldReset(RESET_AFTER_REFUSALS + 1)).toBe(true);
    });
});

describe('constants', () => {
    test('reset tile is outside the 5-tile catch radius of the stand', () => {
        expect(Math.max(Math.abs(RESET_TILE.x - STAND.x), Math.abs(RESET_TILE.z - STAND.z))).toBeGreaterThan(5);
    });
    test('cake items cover the multi-bite stages by contains-match', () => {
        expect(CAKE_ITEMS).toContain('cake'); // 'Cake', '2/3 cake', 'Slice of cake' all contain it
    });
});
