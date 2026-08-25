import { beforeEach, describe, expect, test } from 'bun:test';

import { Ledger, roomUnderCap } from '#/bot/api/market/ledger.js';

let ledger: Ledger;

beforeEach(() => {
    ledger = new Ledger();
    ledger.setStock([{ id: 440, count: 1000 }, { id: 851, count: 12 }], 250_000);
});

describe('stock', () => {
    test('held and coins come from the last bank read', () => {
        expect(ledger.held(440)).toBe(1000);
        expect(ledger.held(9999)).toBe(0);
        expect(ledger.coins()).toBe(250_000);
    });

    test('setStock sums duplicate ids', () => {
        ledger.setStock([{ id: 440, count: 5 }, { id: 440, count: 7 }], 0);
        expect(ledger.held(440)).toBe(12);
    });

    test('setStock replaces rather than merges', () => {
        ledger.setStock([{ id: 440, count: 5 }], 10);
        expect(ledger.held(851)).toBe(0);
        expect(ledger.held(440)).toBe(5);
    });
});

describe('reservations', () => {
    test('available subtracts reservations and adds inventory', () => {
        expect(ledger.available(440, 27)).toBe(1027);
        ledger.reserve('alice', 440, 1000, 0);
        expect(ledger.available(440, 27)).toBe(27);
    });

    test('a second customer cannot be promised the same stack', () => {
        expect(ledger.reserve('alice', 851, 12, 0)).toBe(true);
        expect(ledger.reserve('bob', 851, 12, 0)).toBe(false);
        expect(ledger.reserved(851)).toBe(12);
    });

    test('release frees everything that customer held', () => {
        ledger.reserve('alice', 440, 500, 0);
        ledger.release('alice');
        expect(ledger.reserved(440)).toBe(0);
    });

    test('re-reserving for the same customer replaces the old hold', () => {
        ledger.reserve('alice', 440, 500, 0);
        ledger.reserve('alice', 440, 100, 0);
        expect(ledger.reserved(440)).toBe(100);
    });

    test('expire returns the customers it dropped', () => {
        ledger.reserve('alice', 440, 10, 1_000);
        ledger.reserve('bob', 440, 10, 90_000);
        expect(ledger.expire(100_000, 60_000)).toEqual(['alice']);
        expect(ledger.reserved(440)).toBe(10);
    });

    test('a zero or negative reservation is refused', () => {
        expect(ledger.reserve('alice', 440, 0, 0)).toBe(false);
        expect(ledger.reserve('alice', 440, -5, 0)).toBe(false);
    });

    test('a reservation is backed by bank stock, never by the pack', () => {
        expect(ledger.reserve('alice', 851, 20, 0)).toBe(false);
    });
});

describe('applying a completed trade', () => {
    test('applyBought raises held stock', () => {
        ledger.applyBought(440, 50);
        expect(ledger.held(440)).toBe(1050);
    });

    test('applySold lowers held stock and adds gp', () => {
        ledger.reserve('alice', 440, 100, 0);
        ledger.applySold(440, 100, 2_000);
        expect(ledger.held(440)).toBe(900);
        expect(ledger.coins()).toBe(252_000);
    });

    test('applySold never drives held below zero', () => {
        ledger.applySold(851, 999, 0);
        expect(ledger.held(851)).toBe(0);
    });

    test('spendable adds the coins in the pack', () => {
        expect(ledger.spendable(5_000)).toBe(255_000);
    });
});

describe('roomUnderCap', () => {
    test('reports how many more units may be bought', () => {
        expect(roomUnderCap(5000, 1000, 0)).toBe(4000);
        expect(roomUnderCap(5000, 4990, 20)).toBe(0);
        expect(roomUnderCap(0, 0, 0)).toBe(0);
    });
});
