import { describe, expect, test } from 'bun:test';

import { buildCatalog } from '#/bot/api/market/catalog.js';
import { Ledger } from '#/bot/api/market/ledger.js';
import { coinsIn, expectedFromValuation, formatValuation, valueOffer } from '#/bot/api/market/quote.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, certlink: -1, certtemplate: -1, ...over };
}

const CAT = buildCatalog([
    rec(440, 'Iron ore'),
    rec(441, 'Iron ore', { certlink: 440, certtemplate: 799, stackable: true }),
    rec(995, 'Coins', { stackable: true }),
    rec(1127, 'Rune platebody')
]);

const BOOK: PriceBook = {
    name: 'seers',
    margin: 20,
    maxTradeValue: 1_000_000,
    rows: [{ id: 440, mid: 20, cap: 1000, buying: true, selling: true }]
};

const COINS = 995;

function ledgerWith(held: number): Ledger {
    const l = new Ledger();
    l.setStock([{ id: 440, count: held }], 100_000);
    return l;
}

describe('coinsIn', () => {
    test('sums every coin slot', () => {
        expect(coinsIn([{ id: 995, name: 'Coins', count: 500 }, { id: 440, name: 'Iron ore', count: 3 }], COINS)).toBe(500);
        expect(coinsIn([], COINS)).toBe(0);
    });
});

describe('valueOffer', () => {
    test('prices a plain stack at the buy price', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [{ id: 440, name: 'Iron ore', count: 100 }], COINS);
        expect(v.total).toBe(1800);
        expect(v.lines).toEqual([{ id: 440, name: 'Iron ore', count: 100, each: 18, value: 1800 }]);
    });

    test('a noted stack collapses onto the same row', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [{ id: 441, name: 'Iron ore', count: 100 }], COINS);
        expect(v.total).toBe(1800);
        expect(v.lines[0].id).toBe(440);
    });

    test('noted and unnoted of one row merge into a single line', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [
            { id: 440, name: 'Iron ore', count: 10 },
            { id: 441, name: 'Iron ore', count: 90 }
        ], COINS);
        expect(v.lines).toHaveLength(1);
        expect(v.lines[0].count).toBe(100);
    });

    test('coins are reported separately and never valued', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [{ id: 995, name: 'Coins', count: 5000 }], COINS);
        expect(v.coins).toBe(5000);
        expect(v.total).toBe(0);
        expect(v.lines).toEqual([]);
    });

    test('a slot reporting count 0 still counts as one unit', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [{ id: 440, name: 'Iron ore', count: 0 }], COINS);
        expect(v.lines[0].count).toBe(1);
    });

    test('an unpriced item counts zero and is named', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [
            { id: 440, name: 'Iron ore', count: 100 },
            { id: 1127, name: 'Rune platebody', count: 1 }
        ], COINS);
        expect(v.total).toBe(1800);
        expect(v.unpriced).toEqual([{ name: 'Rune platebody', count: 1 }]);
    });

    test('a row switched off for buying is unpriced', () => {
        const off = { ...BOOK, rows: [{ ...BOOK.rows[0], buying: false }] };
        const v = valueOffer(off, CAT, ledgerWith(0), [{ id: 440, name: 'Iron ore', count: 5 }], COINS);
        expect(v.total).toBe(0);
        expect(v.unpriced).toEqual([{ name: 'Iron ore', count: 5 }]);
    });

    test('units beyond the cap are refused, not silently bought', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(950), [{ id: 440, name: 'Iron ore', count: 100 }], COINS);
        expect(v.lines[0].count).toBe(50);
        expect(v.total).toBe(900);
        expect(v.overCap).toEqual([{ name: 'Iron ore', count: 50 }]);
    });

    test('a full cap prices nothing', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(1000), [{ id: 440, name: 'Iron ore', count: 100 }], COINS);
        expect(v.total).toBe(0);
        expect(v.lines).toEqual([]);
        expect(v.overCap).toEqual([{ name: 'Iron ore', count: 100 }]);
    });
});

describe('expectedFromValuation', () => {
    test('maps the accepted units by unnoted id', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [{ id: 441, name: 'Iron ore', count: 100 }], COINS);
        expect([...expectedFromValuation(v)]).toEqual([[440, 100]]);
    });
});

describe('formatValuation', () => {
    test('itemises the lines and names what pays nothing', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [
            { id: 440, name: 'Iron ore', count: 100 },
            { id: 1127, name: 'Rune platebody', count: 1 }
        ], COINS);
        expect(formatValuation(v)).toBe('Iron ore x100 = 1,800. Rune platebody: not priced, 0. Total 1,800gp.');
    });

    test('an empty offer says so', () => {
        const v = valueOffer(BOOK, CAT, ledgerWith(0), [], COINS);
        expect(formatValuation(v)).toBe('Nothing I buy in that offer.');
    });
});
