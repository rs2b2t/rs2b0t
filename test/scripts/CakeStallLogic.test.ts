import { expect, test, describe } from 'bun:test';

import { classifySteal, shouldReset, RESET_AFTER_REFUSALS, STAND, STAND_ALT, STALL_TILE, CAKE_ITEMS } from '#/bot/scripts/CakeStallLogic.js';

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

describe('shouldReset (refusal streak -> swap to the other stand)', () => {
    test('swaps at the threshold, not before', () => {
        expect(shouldReset(RESET_AFTER_REFUSALS - 1)).toBe(false);
        expect(shouldReset(RESET_AFTER_REFUSALS)).toBe(true);
        expect(shouldReset(RESET_AFTER_REFUSALS + 1)).toBe(true);
    });
});

describe('constants', () => {
    test('both stands are beside the stall (a click from either walks at most a tile)', () => {
        const cheb = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
        expect(cheb(STAND, STALL_TILE)).toBeLessThanOrEqual(2);
        expect(cheb(STAND_ALT, STALL_TILE)).toBeLessThanOrEqual(2);
        expect(cheb(STAND, STAND_ALT)).toBeGreaterThan(0);
    });
    test('cake items cover the multi-bite stages by contains-match', () => {
        expect(CAKE_ITEMS).toContain('cake');
    });
});
