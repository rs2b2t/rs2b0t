import { describe, expect, test } from 'bun:test';

import { AttackClock, URGENT_HP_FRACTION, shouldHoldEat } from '#/bot/api/combat/eatTiming.js';

const healthy = { hpFraction: 0.8, urgentAt: URGENT_HP_FRACTION };

describe('shouldHoldEat', () => {
    test('holds the tick the attack started, so the swing is not stalled', () => {
        expect(shouldHoldEat({ ...healthy, attackedThisTick: true })).toBe(true);
    });

    test('eats on any other tick — the cooldown is free', () => {
        expect(shouldHoldEat({ ...healthy, attackedThisTick: false })).toBe(false);
    });

    test('urgent health eats immediately, even on the attack tick', () => {
        // A missed attack costs one swing; a missed meal costs the run.
        expect(shouldHoldEat({ hpFraction: 0.2, urgentAt: URGENT_HP_FRACTION, attackedThisTick: true })).toBe(false);
        expect(shouldHoldEat({ hpFraction: URGENT_HP_FRACTION, urgentAt: URGENT_HP_FRACTION, attackedThisTick: true })).toBe(false);
    });
});

describe('AttackClock', () => {
    test('marks only the tick an animation began, not the whole swing', () => {
        const c = new AttackClock();
        c.observe(422, 100);
        expect(c.attackedThisTick(100)).toBe(true);
        // Same animation still rendering on later ticks is not a new attack.
        c.observe(422, 101);
        expect(c.attackedThisTick(101)).toBe(false);
        c.observe(422, 102);
        expect(c.attackedThisTick(102)).toBe(false);
    });

    test('a fresh swing after idle marks a new tick', () => {
        const c = new AttackClock();
        c.observe(422, 10);
        c.observe(-1, 11);
        expect(c.attackedThisTick(11)).toBe(false);
        c.observe(422, 14);
        expect(c.attackedThisTick(14)).toBe(true);
    });

    test('switching straight to a different animation counts as a new start', () => {
        const c = new AttackClock();
        c.observe(422, 5);
        c.observe(423, 6);
        expect(c.attackedThisTick(6)).toBe(true);
    });

    test('reports nothing before any animation is seen', () => {
        expect(new AttackClock().attackedThisTick(0)).toBe(false);
    });
});
