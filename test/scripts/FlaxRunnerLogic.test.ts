import { describe, expect, test } from 'bun:test';
import {
    FLAX,
    flaxUnitsInOffer,
    partnerNameMatches,
    TRADE_FAIL_COOLDOWN_MS,
    TRADE_REQUEST_COOLDOWN_MS
} from '#/bot/scripts/FlaxRunnerLogic.js';

describe('partnerNameMatches', () => {
    test('case-insensitive exact match', () => {
        expect(partnerNameMatches('SpinnerBot', 'spinnerbot')).toBe(true);
        expect(partnerNameMatches('SpinnerBot', 'SpinnerBot')).toBe(true);
    });
    test('trims whitespace', () => {
        expect(partnerNameMatches('  Bob  ', 'Bob')).toBe(true);
    });
    test('rejects empty / mismatch', () => {
        expect(partnerNameMatches('', 'Bob')).toBe(false);
        expect(partnerNameMatches('Bob', null)).toBe(false);
        expect(partnerNameMatches('Bob', 'Alice')).toBe(false);
    });
});

describe('flaxUnitsInOffer', () => {
    test('sums flax stacks', () => {
        expect(
            flaxUnitsInOffer([
                { name: FLAX, count: 20 },
                { name: FLAX, count: 5 },
                { name: 'Coins', count: 100 }
            ])
        ).toBe(25);
    });
    test('case-insensitive name', () => {
        expect(flaxUnitsInOffer([{ name: 'flax', count: 3 }])).toBe(3);
    });
    test('empty / non-flax is 0', () => {
        expect(flaxUnitsInOffer([])).toBe(0);
        expect(flaxUnitsInOffer([{ name: 'Bow string', count: 28 }])).toBe(0);
    });
});

describe('trade cooldowns', () => {
    test('fail backoff is longer than request cooldown', () => {
        expect(TRADE_FAIL_COOLDOWN_MS).toBeGreaterThan(TRADE_REQUEST_COOLDOWN_MS);
        expect(TRADE_REQUEST_COOLDOWN_MS).toBeGreaterThanOrEqual(3000);
    });
});
