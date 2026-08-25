import { searchCatalog, type Catalog } from '../api/market/catalog.js';
import { rowOf, type PriceBook, type PriceRow } from '../api/market/priceBook.js';
import { resolvePrices, rowValid } from '../api/market/prices.js';

export interface DisplayRow {
    id: number;
    name: string;
    mid: number;
    buy: number;
    sell: number;
    cap: number;
    buying: boolean;
    selling: boolean;
    pinnedBuy: boolean;
    pinnedSell: boolean;
    valid: boolean;
}

// Why: an override shows verbatim, even when it is invalid. resolvePrices clamps sell to buy+1 for the
// Why: trading path, and echoing that clamp back would silently replace the number the operator typed.
export function displayRows(book: PriceBook, cat: Catalog): DisplayRow[] {
    return book.rows.map(row => {
        const { buy, sell } = resolvePrices(book, row);
        return {
            id: row.id,
            name: cat.byId.get(row.id)?.name ?? `item ${row.id}`,
            mid: row.mid,
            buy: row.buy ?? buy,
            sell: row.sell ?? sell,
            cap: row.cap,
            buying: row.buying,
            selling: row.selling,
            pinnedBuy: row.buy !== undefined,
            pinnedSell: row.sell !== undefined,
            valid: rowValid(book, row)
        };
    });
}

function withRows(book: PriceBook, rows: PriceRow[]): PriceBook {
    return { ...book, rows };
}

export function addRow(book: PriceBook, id: number, seedCost: number): PriceBook {
    if (rowOf(book, id)) {
        return book;
    }
    const mid = Math.max(1, Math.trunc(seedCost));
    return withRows(book, [...book.rows, { id, mid, cap: 0, buying: true, selling: true }]);
}

export function dropRow(book: PriceBook, id: number): PriceBook {
    return withRows(book, book.rows.filter(r => r.id !== id));
}

export function setField(
    book: PriceBook,
    id: number,
    field: 'mid' | 'buy' | 'sell' | 'margin' | 'cap',
    value: number | null
): PriceBook {
    return withRows(book, book.rows.map(r => {
        if (r.id !== id) {
            return r;
        }
        const next = { ...r };
        if (field === 'mid') {
            next.mid = Math.max(1, Math.trunc(value ?? 1));
            return next;
        }
        if (field === 'cap') {
            next.cap = Math.max(0, Math.trunc(value ?? 0));
            return next;
        }
        if (value === null) {
            delete next[field];
            return next;
        }
        next[field] = Math.max(0, Math.trunc(value));
        return next;
    }));
}

export function toggleSide(book: PriceBook, id: number, side: 'buying' | 'selling'): PriceBook {
    return withRows(book, book.rows.map(r => (r.id === id ? { ...r, [side]: !r[side] } : r)));
}

export function setMargin(book: PriceBook, margin: number): PriceBook {
    return { ...book, margin: Math.min(200, Math.max(0, Math.trunc(margin))) };
}

export function setMaxTradeValue(book: PriceBook, value: number): PriceBook {
    return { ...book, maxTradeValue: Math.max(0, Math.trunc(value)) };
}

export function pickerRows(
    book: PriceBook,
    cat: Catalog,
    query: string
): { id: number; name: string; cost: number; added: boolean }[] {
    return searchCatalog(cat, query, 60).map(r => ({
        id: r.id,
        name: r.name,
        cost: r.cost,
        added: rowOf(book, r.id) !== null
    }));
}
