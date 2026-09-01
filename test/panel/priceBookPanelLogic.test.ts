import { describe, expect, test } from 'bun:test';

import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import {
    addRow,
    addRows,
    displayRows,
    dropRow,
    formatPrice,
    parsePrice,
    nextSort,
    pickerRows,
    setField,
    setMargin,
    seedMid,
    setMaxTradeValue,
    toggleSide,
    matchesFilter,
    viewRows,
    type DisplayRow
} from '#/bot/panel/priceBookPanelLogic.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, cost: number): ObjRecord {
    return { id, name, cost, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1 };
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
                category: 'Ores',
                popular: true,
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

    // Why: resolvePrices clamps sell to buy+1 so the trading path never loses money; echoing that clamp into the panel would replace the number the operator typed.
    test('an invalid override still shows what was typed', () => {
        let b = setField(BOOK, 440, 'buy', 100);
        b = setField(b, 440, 'sell', 50);
        expect(displayRows(b, CAT)[0]).toMatchObject({ buy: 100, sell: 50, valid: false });
    });

    test('an id missing from the catalog still renders', () => {
        const orphan = { ...BOOK, rows: [{ id: 9999, mid: 5, cap: 1, buying: true, selling: true }] };
        expect(displayRows(orphan, CAT)[0].name).toBe('item 9999');
    });
});

describe('row edits', () => {
    // Why: 987654 is in no snapshot, so these prove the fallback rather than the table.
    test('addRow seeds mid from the game cost when nothing was ever seen trading, and defaults the cap to zero', () => {
        const b = addRow(BOOK, 987_654, 320);
        expect(b.rows).toHaveLength(2);
        expect(b.rows[1]).toEqual({ id: 987_654, mid: 320, cap: 0, buying: true, selling: true });
    });

    test('addRow seeds mid from the snapshot where there is one', () => {
        expect(addRow(BOOK, 1333, 25_600).rows[1].mid).toBe(25_000);
    });

    test('addRow floors a zero game cost at 1gp', () => {
        expect(addRow(BOOK, 987_654, 0).rows[1].mid).toBe(1);
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


const VIEW: DisplayRow[] = [
    { id: 440, name: 'Iron ore', category: 'Ores', popular: true, mid: 20, buy: 18, sell: 22, cap: 5000, buying: true, selling: true, pinnedBuy: false, pinnedSell: false, valid: true },
    { id: 1515, name: 'Yew logs', category: 'Logs', popular: false, mid: 320, buy: 288, sell: 352, cap: 2000, buying: true, selling: true, pinnedBuy: false, pinnedSell: false, valid: true },
    { id: 453, name: 'Coal', category: 'Other', popular: false, mid: 45, buy: 40, sell: 50, cap: 3000, buying: true, selling: true, pinnedBuy: false, pinnedSell: false, valid: true }
];

describe('viewRows', () => {
    test('one shelf keeps only its own', () => {
        expect(viewRows(VIEW, 'Ores', 'name', 'asc').map(r => r.id)).toEqual([440]);
        expect(viewRows(VIEW, 'All', 'name', 'asc').map(r => r.name)).toEqual(['Coal', 'Iron ore', 'Yew logs']);
    });

    test('a number column sorts by its number, either way round', () => {
        expect(viewRows(VIEW, 'All', 'buy', 'desc').map(r => r.buy)).toEqual([288, 40, 18]);
        expect(viewRows(VIEW, 'All', 'buy', 'asc').map(r => r.buy)).toEqual([18, 40, 288]);
        expect(viewRows(VIEW, 'All', 'cap', 'desc').map(r => r.cap)).toEqual([5000, 3000, 2000]);
    });

    // Why: the book's own order is what gets saved, so looking at it sorted must not reorder it.
    test('sorting leaves the rows it was given alone', () => {
        const before = VIEW.map(r => r.id);
        viewRows(VIEW, 'All', 'sell', 'desc');
        expect(VIEW.map(r => r.id)).toEqual(before);
    });

    test('a shelf with nothing on it is empty, not everything', () => {
        expect(viewRows(VIEW, 'Potions', 'name', 'asc')).toEqual([]);
    });
});

describe('matchesFilter', () => {
    test('no query keeps everything', () => {
        expect(matchesFilter('Rune platebody', '')).toBe(true);
        expect(matchesFilter('Rune platebody', '   ')).toBe(true);
    });

    test('a plain substring, in any case', () => {
        expect(matchesFilter('Iron ore', 'iron')).toBe(true);
        expect(matchesFilter('Iron ore', 'IRON')).toBe(true);
        expect(matchesFilter('Iron ore', 'dragon')).toBe(false);
    });

    test('every word has to land, in whatever order they are typed', () => {
        expect(matchesFilter('Rune platebody', 'body rune')).toBe(true);
        expect(matchesFilter('Rune platebody', 'rune legs')).toBe(false);
    });

    test('the letters in order are enough, so initials find the item', () => {
        expect(matchesFilter('Rune platebody', 'rnplt')).toBe(true);
        expect(matchesFilter('Yew longbow', 'ylb')).toBe(true);
        expect(matchesFilter('Iron ore', 'ino')).toBe(true);
    });

    // Why: two letters as a subsequence match most of the catalogue, so a short query stays a substring.
    test('two letters do not spray', () => {
        expect(matchesFilter('Rune platebody', 'rb')).toBe(false);
        expect(matchesFilter('Rune platebody', 'ru')).toBe(true);
    });

    test('punctuation in the name is not something you have to type', () => {
        expect(matchesFilter("Zamorak monk's robe", 'monks robe')).toBe(true);
    });
});

describe('viewRows filtering', () => {
    test('narrows to what matches, and keeps the shelf', () => {
        expect(viewRows(VIEW, 'All', 'name', 'asc', 'iron').map(r => r.name)).toEqual(['Iron ore']);
        expect(viewRows(VIEW, 'All', 'name', 'asc', 'ore').map(r => r.name)).toEqual(['Iron ore']);
        expect(viewRows(VIEW, 'Ores', 'name', 'asc', 'yew')).toEqual([]);
    });

    test('no query is the same list as before', () => {
        expect(viewRows(VIEW, 'All', 'name', 'asc', '')).toEqual(viewRows(VIEW, 'All', 'name', 'asc'));
    });
});

describe('nextSort', () => {
    test('a new column starts the way that column reads best', () => {
        expect(nextSort({ key: 'name', dir: 'asc' }, 'buy')).toEqual({ key: 'buy', dir: 'desc' });
        expect(nextSort({ key: 'buy', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
    });

    test('the same column turns around', () => {
        expect(nextSort({ key: 'buy', dir: 'desc' }, 'buy')).toEqual({ key: 'buy', dir: 'asc' });
        expect(nextSort({ key: 'buy', dir: 'asc' }, 'buy')).toEqual({ key: 'buy', dir: 'desc' });
    });
});

describe('addRows', () => {
    test('adds a whole shelf and skips what is already carried', () => {
        const filled = addRows(BOOK, [{ id: 440, cost: 17 }, { id: 987_654, cost: 320 }, { id: 453, cost: 45 }]);
        expect(filled.rows.map(r => r.id)).toEqual([440, 987_654, 453]);
        // Why: 440 was already carried, so its own mid survives rather than being reseeded.
        expect(filled.rows.find(r => r.id === 440)?.mid).toBe(20);
        expect(filled.rows.find(r => r.id === 987_654)?.mid).toBe(320);
    });

    test('adding nothing leaves the book as it was', () => {
        expect(addRows(BOOK, [])).toEqual(BOOK);
    });
});


describe('seedMid', () => {
    // Why: a general store pays 22gp for a rune scimitar's worth of nothing, so the shop value is not a price.
    test('a snapshotted item starts at what it was trading for', () => {
        expect(seedMid(1333, 25_600)).toBe(25_000);
        expect(seedMid(1436, 1)).toBe(192);
    });

    test('an item with no snapshot falls back to the game value', () => {
        expect(seedMid(987_654, 320)).toBe(320);
    });

    test('a row never starts at nothing', () => {
        expect(seedMid(987_654, 0)).toBe(1);
        expect(seedMid(987_654, -5)).toBe(1);
    });
});


describe('formatPrice', () => {
    test('small enough to read stays exact', () => {
        expect(formatPrice(0)).toBe('0');
        expect(formatPrice(22)).toBe('22');
        expect(formatPrice(9_999)).toBe('9999');
    });

    test('ten thousand and up reads in K, rounded down', () => {
        expect(formatPrice(10_000)).toBe('10K');
        expect(formatPrice(13_500)).toBe('13K');
        expect(formatPrice(999_999)).toBe('999K');
    });

    test('a million and up reads in M, to two places without trailing zeros', () => {
        expect(formatPrice(1_000_000)).toBe('1M');
        expect(formatPrice(1_250_420)).toBe('1.25M');
        expect(formatPrice(2_500_000)).toBe('2.5M');
        expect(formatPrice(256_250_000)).toBe('256.25M');
    });
});

describe('parsePrice', () => {
    test('reads back everything the box can show', () => {
        expect(parsePrice('9999')).toBe(9999);
        expect(parsePrice('999K')).toBe(999_000);
        expect(parsePrice('1.25M')).toBe(1_250_000);
        expect(parsePrice('1M')).toBe(1_000_000);
    });

    test('takes what a person would type instead', () => {
        expect(parsePrice('1,250,420')).toBe(1_250_420);
        expect(parsePrice(' 25k ')).toBe(25_000);
        expect(parsePrice('1.3m')).toBe(1_300_000);
        expect(parsePrice('0.5k')).toBe(500);
    });

    test('nonsense is nothing, not zero', () => {
        expect(parsePrice('')).toBeNull();
        expect(parsePrice('abc')).toBeNull();
        expect(parsePrice('1.2.3')).toBeNull();
        expect(parsePrice('12KK')).toBeNull();
    });

    // Why: the box shows what it parses, so anything it displays has to survive a round trip untouched.
    test('what the box shows parses back to what it shows', () => {
        for (const n of [0, 22, 9_999, 10_000, 13_000, 999_000, 1_000_000, 1_250_000, 256_250_000]) {
            expect(parsePrice(formatPrice(n))).toBe(n);
        }
    });
});
