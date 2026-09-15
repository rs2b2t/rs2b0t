import { describe, expect, test } from 'bun:test';

import { MAX_FILE_BYTES, exportOrderbooks, mergeOrderbooks, parseOrderbookFile, resolvePrices, validateBooks } from '#/bot/api/market/orderbook-format.js';
import type { PriceBook } from '#/bot/api/market/orderbook-format.js';
import { resolvePrices as resolveBotPrices } from '#/bot/api/market/prices.js';

const SEERS: PriceBook = {
    name: 'seers',
    margin: 20,
    maxTradeValue: 500_000,
    rows: [{ id: 440, mid: 100, cap: 5000, buying: true, selling: false, buy: 85 }]
};

describe('orderbook transfer format', () => {
    test('round trips native arrays and versioned exports exactly', () => {
        expect(parseOrderbookFile(JSON.stringify([SEERS]))).toEqual([SEERS]);
        const exported = exportOrderbooks([SEERS]);
        expect(JSON.parse(exported)).toEqual({ format: 'rs2b0t-orderbooks', version: 1, books: [SEERS] });
        expect(parseOrderbookFile(exported)).toEqual([SEERS]);
        expect(resolvePrices(SEERS, SEERS.rows[0])).toEqual({ buy: 85, sell: 110 });
    });

    test('rejects a malformed second row without changing its input', () => {
        const raw = [{ ...SEERS, rows: [...SEERS.rows, { id: 453, mid: 0, cap: 10, buying: true, selling: true }] }];
        const before = structuredClone(raw);
        expect(() => validateBooks(raw)).toThrow(/mid/);
        expect(raw).toEqual(before);
    });

    test('rejects unknown fields and case-insensitive duplicates', () => {
        expect(() => validateBooks([{ ...SEERS, future: true }])).toThrow(/unknown field/i);
        expect(() => validateBooks([SEERS, { ...SEERS, name: 'SEERS' }])).toThrow(/duplicate book name/i);
        expect(() => validateBooks([{ ...SEERS, rows: [...SEERS.rows, { ...SEERS.rows[0] }] }])).toThrow(/duplicate item id/i);
        expect(() => validateBooks([{ ...SEERS, name: 'seers ' }])).toThrow(/whitespace/i);
    });

    test('preserves zero overrides and permits inverted explicit prices for repair', () => {
        const book = { ...SEERS, rows: [{ ...SEERS.rows[0], buy: 0, sell: 0, margin: 0 }] };
        expect(validateBooks([book])).toEqual([book]);
        expect(resolvePrices(book, book.rows[0])).toEqual({ buy: 1, sell: 2 });
    });

    test('matches the trading path for calculated, explicit and clamped prices', () => {
        const rows = [SEERS.rows[0], { ...SEERS.rows[0], id: 441, mid: 17, margin: 15, buy: undefined }, { ...SEERS.rows[0], id: 442, mid: 1, buy: 0, sell: 0 }];
        for (const row of rows) {
            expect(resolvePrices(SEERS, row)).toEqual(resolveBotPrices(SEERS, row));
        }
    });

    test('replaces conflicts and retains unrelated books', () => {
        const other = { ...SEERS, name: 'varrock', rows: [] };
        const replacement = { ...SEERS, name: 'SEERS', maxTradeValue: 123 };
        expect(mergeOrderbooks([SEERS, other], [replacement])).toEqual([replacement, other]);
    });

    test('rejects unsupported envelopes and files over one MiB', () => {
        expect(() => parseOrderbookFile('{"format":"rs2b0t-orderbooks","version":2,"books":[]}')).toThrow(/version/);
        expect(() => parseOrderbookFile(' '.repeat(MAX_FILE_BYTES + 1))).toThrow(/1 MiB/);
    });

    test('rejects a valid export whose encoded envelope exceeds one MiB', () => {
        const rows = Array.from({ length: 5000 }, (_, id) => ({
            id,
            mid: 2147483647,
            buy: 2147483647,
            sell: 2147483647,
            margin: 200,
            cap: 2147483647,
            buying: true,
            selling: true
        }));
        expect(() =>
            exportOrderbooks([
                { ...SEERS, name: 'a', rows },
                { ...SEERS, name: 'b', rows }
            ])
        ).toThrow(/1 MiB/);
    });

    test('validates combined collection limits after a merge', () => {
        const books = (prefix: string) => Array.from({ length: 30 }, (_, i) => ({ ...SEERS, name: `${prefix}${i}`, rows: [] }));
        expect(() => mergeOrderbooks(books('old'), books('new'))).toThrow(/50 books/);
    });
});
