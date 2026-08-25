import { describe, expect, test } from 'bun:test';

import { resolvePrices, rowValid } from '#/bot/api/market/prices.js';
import type { PriceBook, PriceRow } from '#/bot/api/market/priceBook.js';

function book(over: Partial<PriceBook> = {}): PriceBook {
    return { name: 'default', margin: 20, maxTradeValue: 1_000_000, rows: [], ...over };
}

function row(over: Partial<PriceRow> = {}): PriceRow {
    return { id: 440, mid: 100, cap: 5000, buying: true, selling: true, ...over };
}

describe('resolvePrices', () => {
    test('splits the spread either side of mid', () => {
        expect(resolvePrices(book(), row())).toEqual({ buy: 90, sell: 110 });
    });

    test('buy floors and sell ceils', () => {
        expect(resolvePrices(book({ margin: 15 }), row({ mid: 17 }))).toEqual({ buy: 15, sell: 19 });
    });

    test('a row margin beats the book margin', () => {
        expect(resolvePrices(book(), row({ margin: 50 }))).toEqual({ buy: 75, sell: 125 });
    });

    test('an explicit override beats both', () => {
        expect(resolvePrices(book(), row({ buy: 60, sell: 500 }))).toEqual({ buy: 60, sell: 500 });
    });

    test('buy never drops below 1gp', () => {
        expect(resolvePrices(book({ margin: 200 }), row({ mid: 1 })).buy).toBe(1);
    });

    test('sell is forced above buy when rounding collapses them', () => {
        const { buy, sell } = resolvePrices(book({ margin: 1 }), row({ mid: 1 }));
        expect(sell).toBeGreaterThan(buy);
    });

    test('a zero margin still leaves a 1gp spread', () => {
        const { buy, sell } = resolvePrices(book({ margin: 0 }), row({ mid: 50 }));
        expect(buy).toBe(50);
        expect(sell).toBe(51);
    });
});

describe('rowValid', () => {
    test('true for a normal row', () => {
        expect(rowValid(book(), row())).toBe(true);
    });

    test('false when an override inverts the spread', () => {
        expect(rowValid(book(), row({ buy: 200, sell: 100 }))).toBe(false);
    });

    test('false when overrides are equal', () => {
        expect(rowValid(book(), row({ buy: 100, sell: 100 }))).toBe(false);
    });

    test('false for a non-positive mid with no overrides', () => {
        expect(rowValid(book(), row({ mid: 0 }))).toBe(false);
    });

    test('false for a negative cap', () => {
        expect(rowValid(book(), row({ cap: -1 }))).toBe(false);
    });
});
