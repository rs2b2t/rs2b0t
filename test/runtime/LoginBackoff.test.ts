import { describe, expect, test } from 'bun:test';
import { LoginBackoff, RATE_LIMIT_FIRST_MS, RATE_LIMIT_STEP_MS } from '#/bot/runtime/LoginBackoff.js';

describe('LoginBackoff', () => {
    test('first rate-limited attempt waits 20s', () => {
        const b = new LoginBackoff();
        expect(b.next()).toBe(20000);
    });

    test('each consecutive hit adds 45s', () => {
        const b = new LoginBackoff();
        expect(b.next()).toBe(20000);
        expect(b.next()).toBe(65000);
        expect(b.next()).toBe(110000);
    });

    test('reset returns to the 20s base', () => {
        const b = new LoginBackoff();
        b.next();
        b.next();
        b.reset();
        expect(b.next()).toBe(RATE_LIMIT_FIRST_MS);
        expect(b.next()).toBe(RATE_LIMIT_FIRST_MS + RATE_LIMIT_STEP_MS);
    });
});
