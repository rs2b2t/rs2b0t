import { beforeEach, describe, expect, test } from 'bun:test';

import { Ledger } from '#/bot/api/market/ledger.js';

const IRON = 440;
const YEW = 1515;

let ledger: Ledger;

beforeEach(() => {
    ledger = new Ledger();
    ledger.setStock([{ id: IRON, count: 1000 }, { id: YEW, count: 12 }]);
});

describe('what the bank held at the last look', () => {
    test('held comes from the last read', () => {
        expect(ledger.held(IRON)).toBe(1000);
        expect(ledger.held(9999)).toBe(0);
    });

    test('setStock sums duplicate ids', () => {
        ledger.setStock([{ id: IRON, count: 5 }, { id: IRON, count: 7 }]);
        expect(ledger.held(IRON)).toBe(12);
    });

    test('setStock replaces rather than merges', () => {
        ledger.setStock([{ id: IRON, count: 5 }]);
        expect(ledger.held(YEW)).toBe(0);
    });
});

describe('trades move it between bank trips', () => {
    // Why: the per-item cap has to mean something before the next time the bank is opened.
    test('buying raises the count and selling lowers it', () => {
        ledger.add(IRON, 50);
        expect(ledger.held(IRON)).toBe(1050);
        ledger.add(IRON, -100);
        expect(ledger.held(IRON)).toBe(950);
    });

    test('it never goes below zero', () => {
        ledger.add(YEW, -999);
        expect(ledger.held(YEW)).toBe(0);
    });

    test('an unknown id starts from nothing', () => {
        ledger.add(9999, 5);
        expect(ledger.held(9999)).toBe(5);
    });
});
