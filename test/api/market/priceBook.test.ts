import { describe, expect, test } from 'bun:test';

import {
    DEFAULT_MARGIN,
    parseBooks,
    removeBook,
    rowOf,
    serializeBooks,
    uniqueBookName,
    upsertBook,
    type PriceBook
} from '#/bot/api/market/priceBook.js';

const BOOK: PriceBook = {
    name: 'seers',
    margin: 20,
    maxTradeValue: 500_000,
    rows: [{ id: 440, mid: 17, cap: 5000, buying: true, selling: true }]
};

describe('parseBooks', () => {
    test('round-trips through serialize', () => {
        expect(parseBooks(serializeBooks([BOOK]))).toEqual([BOOK]);
    });

    test('bad JSON yields an empty list rather than throwing', () => {
        expect(parseBooks('not json')).toEqual([]);
        expect(parseBooks('{}')).toEqual([]);
    });

    test('an unnamed book is dropped', () => {
        expect(parseBooks(JSON.stringify([{ rows: [] }, { name: '  ' }]))).toEqual([]);
    });

    test('fills missing fields with defaults and drops malformed rows', () => {
        const parsed = parseBooks(JSON.stringify([
            { name: 'x', rows: [{ id: 440 }, { mid: 5 }, { id: 'nope', mid: 5 }] }
        ]));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].margin).toBe(DEFAULT_MARGIN);
        expect(parsed[0].maxTradeValue).toBe(1_000_000);
        expect(parsed[0].rows).toEqual([{ id: 440, mid: 1, cap: 0, buying: true, selling: true }]);
    });

    test('keeps overrides that are present', () => {
        const parsed = parseBooks(JSON.stringify([
            { name: 'x', rows: [{ id: 440, mid: 20, buy: 15, margin: 40, cap: 10, selling: false }] }
        ]));
        expect(parsed[0].rows[0]).toEqual({ id: 440, mid: 20, buy: 15, margin: 40, cap: 10, buying: true, selling: false });
    });
});

describe('upsertBook / removeBook / uniqueBookName / rowOf', () => {
    test('upsert replaces by name and appends otherwise', () => {
        const changed = { ...BOOK, margin: 30 };
        expect(upsertBook([BOOK], changed)).toEqual([changed]);
        expect(upsertBook([BOOK], { ...BOOK, name: 'varrock' })).toHaveLength(2);
    });

    test('remove drops by name, case-insensitively', () => {
        expect(removeBook([BOOK], 'SEERS')).toEqual([]);
    });

    test('uniqueBookName suffixes a collision', () => {
        expect(uniqueBookName([BOOK], 'seers')).toBe('seers 2');
        expect(uniqueBookName([BOOK], 'varrock')).toBe('varrock');
    });

    test('rowOf finds by id', () => {
        expect(rowOf(BOOK, 440)?.mid).toBe(17);
        expect(rowOf(BOOK, 441)).toBeNull();
    });
});
