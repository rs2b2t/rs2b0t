import { describe, expect, test } from 'bun:test';
import { appraise, describeAppraisal } from '#/bot/api/market/appraise.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import { resolveQuote } from '#/bot/scripts/MarketMaker/marketMakerLogic.js';

const cat = buildCatalog(ITEM_DB.map(item => ({
    id: item.id, name: item.name, cost: item.cost, members: item.members,
    stackable: false, equippable: item.slot !== undefined, certlink: -1, certtemplate: -1
})));
const rune = { name: 'Rune set', itemIds: [1163, 1127, 1079] };
const book: PriceBook = {
    name: 'Sets', margin: 20, maxTradeValue: 100_000,
    rows: [
        { id: 1163, mid: 80, sell: 101, cap: 100, buying: true, selling: true },
        { id: 1127, mid: 160, sell: 202, cap: 100, buying: true, selling: true },
        { id: 1079, mid: 240, sell: 303, cap: 100, buying: true, selling: true }
    ]
};
const quote = (query: string, priceBook = book) => resolveQuote({ cat, book: priceBook, query, side: 'selling', qtyImplied: false });

describe('set names', () => {
    test.each([
        ['rune sets', [1163, 1127, 1079]],
        ['addy sets', [1161, 1123, 1073]],
        ['adamant set', [1161, 1123, 1073]],
        ['mithril sets', [1159, 1121, 1071]],
        ['mith set', [1159, 1121, 1071]],
        ['black sets', [1165, 1125, 1077]],
        ['steel sets', [1157, 1119, 1069]],
        ['black dragonhide sets', [2503, 2497, 2491]],
        ['red dragonhide sets', [2501, 2495, 2489]],
        ['blue dragonhide sets', [2499, 2493, 2487]],
        ['green dragonhide sets', [1135, 1099, 1065]],
        ['black dhide set', [2503, 2497, 2491]],
        ["black d'hide sets", [2503, 2497, 2491]],
        ['leather set', [1129, 1095, 1063]],
        ['super sets', [157, 145, 163]]
    ] satisfies [string, number[]][])('resolves %s to one of each piece', (query, itemIds) => {
        const priceBook = { ...book, rows: itemIds.map(id => ({ id, mid: 100, cap: 100, buying: true, selling: true })) };
        expect(quote(query, priceBook)).toMatchObject({ kind: 'set', set: { itemIds: [...itemIds] } });
    });

    test('singular sets work with an implied quantity and mixed case', () => {
        expect(resolveQuote({ cat, book, query: 'Rune Set', side: 'selling', qtyImplied: true })).toEqual({ kind: 'set', set: rune });
    });

    test.each(['missing', 'disabled', 'invalid'])('does not sell a set with a %s component price', mode => {
        const rows = mode === 'missing' ? book.rows.slice(1) : book.rows.map(row => row.id === 1163
            ? { ...row, selling: mode !== 'disabled', mid: mode === 'invalid' ? 0 : row.mid } : row);
        expect(quote('rune sets', { ...book, rows }).kind).toBe('miss');
    });

    test('does not confuse black armour with black dragonhide or a single item', () => {
        expect(quote('black dragonhide sets').kind).toBe('miss');
        expect(quote('rune full helm')).toEqual({ kind: 'hit', id: 1163, name: 'Rune full helm' });
    });
});

function sale(stock: Record<number, number> = { 1163: 10, 1127: 10, 1079: 10 }, priceBook = book) {
    return appraise({
        cat, book: priceBook, coinId: 995, intent: { set: rune, maxQty: 10 }, theirOffer: [],
        desk: { available: id => stock[id] ?? 0, held: id => stock[id] ?? 0, purse: 200_000 }
    });
}

describe('set prices and quantities', () => {
    test('ten sets offer ten of every component for the sum of individual sell prices', () => {
        const result = sale();
        expect(result.kind).toBe('sell');
        expect([...result.owe]).toEqual([[1163, 10], [1127, 10], [1079, 10]]);
        expect([...result.want]).toEqual([[995, 6060]]);
        expect(result.total).toBe(6060);
        expect(describeAppraisal(result)).toContain('You owe 6,060gp.');
    });

    test('the least stocked component limits every component to complete sets', () => {
        const result = sale({ 1163: 10, 1127: 3, 1079: 8 });
        expect([...result.owe]).toEqual([[1163, 3], [1127, 3], [1079, 3]]);
        expect(result.total).toBe(1818);
    });

    test('a missing component never produces a partial set', () => {
        expect(sale({ 1163: 10, 1127: 10 }).kind).toBe('nothing');
    });

    test('the trade value cap applies to the combined set price', () => {
        const result = sale(undefined, { ...book, maxTradeValue: 1500 });
        expect([...result.owe]).toEqual([[1163, 2], [1127, 2], [1079, 2]]);
        expect(result.total).toBe(1212);
    });

    test('disabling a component after the quote stops the whole sale', () => {
        const changed = { ...book, rows: book.rows.map(row => ({ ...row, selling: row.id !== 1127 })) };
        expect(sale(undefined, changed).kind).toBe('nothing');
    });
});
