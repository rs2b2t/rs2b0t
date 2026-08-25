import { describe, expect, test } from 'bun:test';

import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import {
    addRow,
    displayRows,
    dropRow,
    pickerRows,
    setField,
    setMargin,
    setMaxTradeValue,
    toggleSide
} from '#/bot/panel/priceBookPanelLogic.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, cost: number): ObjRecord {
    return { id, name, cost, stackable: false, members: false, certlink: -1, certtemplate: -1 };
}

const CAT = buildCatalog([rec(440, 'Iron ore', 17), rec(1515, 'Yew logs', 320), rec(995, 'Coins', 1)]);

const BOOK: PriceBook = {
    name: 'seers',
    margin: 20,
    maxTradeValue: 500_000,
    rows: [{ id: 440, mid: 20, cap: 5000, buying: true, selling: true }]
};

describe('displayRows', () => {
    test('resolves gp and flags nothing pinned', () => {
        expect(displayRows(BOOK, CAT)).toEqual([
            {
                id: 440,
                name: 'Iron ore',
                mid: 20,
                buy: 18,
                sell: 22,
                cap: 5000,
                buying: true,
                selling: true,
                pinnedBuy: false,
                pinnedSell: false,
                valid: true
            }
        ]);
    });

    test('an override shows as pinned', () => {
        const pinned = setField(BOOK, 440, 'buy', 16);
        expect(displayRows(pinned, CAT)[0]).toMatchObject({ buy: 16, pinnedBuy: true, pinnedSell: false });
    });

    test('an inverted override flags the row invalid', () => {
        let b = setField(BOOK, 440, 'buy', 100);
        b = setField(b, 440, 'sell', 50);
        expect(displayRows(b, CAT)[0].valid).toBe(false);
    });

    test('an id missing from the catalog still renders', () => {
        const orphan = { ...BOOK, rows: [{ id: 9999, mid: 5, cap: 1, buying: true, selling: true }] };
        expect(displayRows(orphan, CAT)[0].name).toBe('item 9999');
    });
});

describe('row edits', () => {
    test('addRow seeds mid from the game cost and defaults the cap to zero', () => {
        const b = addRow(BOOK, 1515, 320);
        expect(b.rows).toHaveLength(2);
        expect(b.rows[1]).toEqual({ id: 1515, mid: 320, cap: 0, buying: true, selling: true });
    });

    test('addRow floors a zero game cost at 1gp', () => {
        expect(addRow(BOOK, 1515, 0).rows[1].mid).toBe(1);
    });

    test('addRow is idempotent for an id already present', () => {
        expect(addRow(BOOK, 440, 17).rows).toHaveLength(1);
    });

    test('dropRow removes by id', () => {
        expect(dropRow(BOOK, 440).rows).toEqual([]);
    });

    test('setField with null clears an override', () => {
        const pinned = setField(BOOK, 440, 'buy', 16);
        expect(setField(pinned, 440, 'buy', null).rows[0].buy).toBeUndefined();
    });

    test('setField clamps mid and cap to sane floors', () => {
        expect(setField(BOOK, 440, 'mid', 0).rows[0].mid).toBe(1);
        expect(setField(BOOK, 440, 'cap', -5).rows[0].cap).toBe(0);
    });

    test('setField ignores an id the book does not hold', () => {
        expect(setField(BOOK, 9999, 'mid', 50).rows).toEqual(BOOK.rows);
    });

    test('toggleSide flips one side only', () => {
        const b = toggleSide(BOOK, 440, 'buying');
        expect(b.rows[0].buying).toBe(false);
        expect(b.rows[0].selling).toBe(true);
    });

    test('editing never mutates the input book', () => {
        const before = JSON.stringify(BOOK);
        addRow(BOOK, 1515, 320);
        dropRow(BOOK, 440);
        setMargin(BOOK, 99);
        setField(BOOK, 440, 'mid', 1);
        toggleSide(BOOK, 440, 'selling');
        expect(JSON.stringify(BOOK)).toBe(before);
    });
});

describe('book-level fields', () => {
    test('margin clamps to 0..200', () => {
        expect(setMargin(BOOK, -5).margin).toBe(0);
        expect(setMargin(BOOK, 500).margin).toBe(200);
        expect(setMargin(BOOK, 35).margin).toBe(35);
    });

    test('maxTradeValue floors at zero', () => {
        expect(setMaxTradeValue(BOOK, -1).maxTradeValue).toBe(0);
    });
});

describe('pickerRows', () => {
    test('marks what the book already holds', () => {
        expect(pickerRows(BOOK, CAT, 'iron')).toEqual([{ id: 440, name: 'Iron ore', cost: 17, added: true }]);
    });

    test('search finds unadded items', () => {
        expect(pickerRows(BOOK, CAT, 'yew')).toEqual([{ id: 1515, name: 'Yew logs', cost: 320, added: false }]);
    });

    test('an empty query lists the catalog', () => {
        expect(pickerRows(BOOK, CAT, '')).toHaveLength(3);
    });
});
