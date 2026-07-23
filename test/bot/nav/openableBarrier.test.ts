import { describe, expect, test } from 'bun:test';
import { isOpenableBarrier, isOpenBarrierLeaf } from '#/bot/nav/WalkExecutor.js';

describe('isOpenableBarrier', () => {
    test("a shut Door offering 'Open' is a barrier", () => {
        expect(isOpenableBarrier('Door', ['Open'])).toBe(true);
    });

    test("a Gate offering 'Open-quietly' is a barrier (Open-prefix, not literal 'Open')", () => {
        expect(isOpenableBarrier('Gate', ['Open-quietly'])).toBe(true);
    });

    test("a Wardrobe offering 'Open' is NOT a barrier (name filter — the wardrobe incident)", () => {
        expect(isOpenableBarrier('Wardrobe', ['Open'])).toBe(false);
    });

    test("an already-open Door (offers 'Close', not 'Open') is not a barrier", () => {
        expect(isOpenableBarrier('Door', ['Close'])).toBe(false);
    });

    test('a null name is never a barrier', () => {
        expect(isOpenableBarrier(null, ['Open'])).toBe(false);
    });

    test('name match is case-insensitive', () => {
        expect(isOpenableBarrier('Large door', ['Open'])).toBe(true);
        expect(isOpenableBarrier('WOODEN GATE', ['Open'])).toBe(true);
    });

    test('tolerates null op slots in the ops array', () => {
        expect(isOpenableBarrier('Door', [null, 'Open'])).toBe(true);
        expect(isOpenableBarrier('Door', [null, 'Close'])).toBe(false);
        expect(isOpenableBarrier('Door', [])).toBe(false);
    });
});

describe('isOpenBarrierLeaf', () => {
    test("an open Door offering 'Close' is an open leaf", () => {
        expect(isOpenBarrierLeaf('Door', ['Close'])).toBe(true);
    });

    test("a Gate offering 'Close-quietly' is an open leaf (Close-prefix, not literal 'Close')", () => {
        expect(isOpenBarrierLeaf('Gate', ['Close-quietly'])).toBe(true);
    });

    test("a shut Door (offers 'Open', not 'Close') is NOT an open leaf", () => {
        expect(isOpenBarrierLeaf('Door', ['Open'])).toBe(false);
    });

    test("a Chest offering 'Close' is NOT an open leaf (name filter)", () => {
        expect(isOpenBarrierLeaf('Chest', ['Close'])).toBe(false);
    });

    test('a null name is never an open leaf', () => {
        expect(isOpenBarrierLeaf(null, ['Close'])).toBe(false);
    });

    test('name match is case-insensitive', () => {
        expect(isOpenBarrierLeaf('Large door', ['Close'])).toBe(true);
        expect(isOpenBarrierLeaf('WOODEN GATE', ['Close'])).toBe(true);
    });

    test('tolerates null op slots in the ops array', () => {
        expect(isOpenBarrierLeaf('Door', [null, 'Close'])).toBe(true);
        expect(isOpenBarrierLeaf('Door', [null, 'Open'])).toBe(false);
        expect(isOpenBarrierLeaf('Door', [])).toBe(false);
    });

    test('is mutually exclusive with isOpenableBarrier', () => {
        expect(isOpenableBarrier('Door', ['Open'])).toBe(true);
        expect(isOpenBarrierLeaf('Door', ['Open'])).toBe(false);
        expect(isOpenableBarrier('Door', ['Close'])).toBe(false);
        expect(isOpenBarrierLeaf('Door', ['Close'])).toBe(true);
    });
});
