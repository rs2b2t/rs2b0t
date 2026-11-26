import { describe, expect, test } from 'bun:test';
import { withdrawOp, withdrawXOpIndex } from '#/bot/api/bank/bankOps.js';

describe('withdrawOp', () => {
    const spaceOps = ['Withdraw 1', 'Withdraw 5', 'Withdraw 10', 'Withdraw All', null];
    const hyphenOps = ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All'];

    test('resolves the all op in both label forms', () => {
        expect(withdrawOp(spaceOps, 'all')).toBe('Withdraw All');
        expect(withdrawOp(hyphenOps, 'all')).toBe('Withdraw-All');
    });

    test('resolves the 10 op in both label forms', () => {
        expect(withdrawOp(spaceOps, '10')).toBe('Withdraw 10');
        expect(withdrawOp(hyphenOps, '10')).toBe('Withdraw-10');
    });

    test("'5' is bounded — never catches Withdraw 10", () => {
        expect(withdrawOp(spaceOps, '5')).toBe('Withdraw 5');
        expect(withdrawOp(hyphenOps, '5')).toBe('Withdraw-5');
        expect(withdrawOp(['Withdraw 10', 'Withdraw-X'], '5')).toBeNull();
    });

    test('resolves the x op in both label forms', () => {
        expect(withdrawOp(['Withdraw-X', 'Withdraw-1'], 'x')).toBe('Withdraw-X');
        expect(withdrawOp(['Withdraw X'], 'x')).toBe('Withdraw X');
    });

    test("'1' is anchored — never catches Withdraw 10", () => {
        expect(withdrawOp(spaceOps, '1')).toBe('Withdraw 1');
        expect(withdrawOp(['Withdraw 10', 'Withdraw All'], '1')).toBeNull();
    });

    test("'any' takes the first withdraw op; non-withdraw ops never match", () => {
        expect(withdrawOp(['Examine', 'Withdraw 5'], 'any')).toBe('Withdraw 5');
        expect(withdrawOp(['Examine', null], 'any')).toBeNull();
        expect(withdrawOp(['Examine', null], 'all')).toBeNull();
    });
});

describe('withdrawXOpIndex', () => {
    test('returns the first matching one-based slot, counting null slots', () => {
        expect(withdrawXOpIndex([null, 'Withdraw 1', null, 'withdraw X', 'Withdraw-X'])).toBe(4);
    });

    test('returns -1 when the menu has no Withdraw-X', () => {
        expect(withdrawXOpIndex([null, 'Withdraw All'])).toBe(-1);
    });
});
