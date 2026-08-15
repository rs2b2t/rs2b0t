import { describe, expect, test } from 'bun:test';
import {
    FLAX,
    canReceiveFlaxOffer,
    flaxUnitsInOffer,
    partnerNameMatches,
    spinnerNeedsClearPack,
    TRADE_FAIL_COOLDOWN_TICKS,
    TRADE_REQUEST_COOLDOWN_TICKS
} from '#/bot/scripts/FlaxRunner/FlaxRunnerLogic.js';

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
    test('fail backoff is longer than request cooldown (ticks)', () => {
        expect(TRADE_FAIL_COOLDOWN_TICKS).toBeGreaterThan(TRADE_REQUEST_COOLDOWN_TICKS);
        expect(TRADE_REQUEST_COOLDOWN_TICKS).toBeGreaterThanOrEqual(5);
    });
});

describe('spinnerNeedsClearPack / canReceiveFlaxOffer', () => {
    test('empty pack does not need bank; junk without flax does', () => {
        expect(spinnerNeedsClearPack(0, 0)).toBe(false);
        expect(spinnerNeedsClearPack(0, 5)).toBe(true); // random-event garbage
        expect(spinnerNeedsClearPack(0, 28)).toBe(true);
    });
    test('still holding flax is not a clear-pack bank (go spin / climb)', () => {
        expect(spinnerNeedsClearPack(10, 10)).toBe(false);
        expect(spinnerNeedsClearPack(1, 28)).toBe(false);
    });
    test('receive needs at least one free slot for a flax stack', () => {
        expect(canReceiveFlaxOffer(0, 28)).toBe(false);
        expect(canReceiveFlaxOffer(1, 28)).toBe(true);
        expect(canReceiveFlaxOffer(28, 28)).toBe(true);
        expect(canReceiveFlaxOffer(0, 0)).toBe(true);
    });
});
