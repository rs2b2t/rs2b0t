import { isPopular, shelfOf, type Category } from '../api/market/categories.js';
import { searchCatalog, type Catalog } from '../api/market/catalog.js';
import { rowOf, type PriceBook, type PriceRow } from '../api/market/priceBook.js';
import { MARKET_PRICES } from '../data/marketprices.js';
import { resolvePrices, rowValid } from '../api/market/prices.js';

export interface DisplayRow {
    id: number;
    name: string;
    category: Category;
    /** Popular overlaps the other shelves, so it is carried alongside the category rather than in it. */
    popular: boolean;
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
        const item = cat.byId.get(row.id);
        return {
            id: row.id,
            name: item?.name ?? `item ${row.id}`,
            category: item ? shelfOf(item) : 'Other',
            popular: item ? isPopular(item) : false,
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

const SNAPSHOT = new Map(MARKET_PRICES.map(p => [p.id, p.mid]));

/** What a fresh row starts at: what the item was seen trading for, or the game's own value where it was not. */
// Why: the shop value is what a general store pays, which is nowhere near what players pay each other, so a
// Why: book seeded from it quotes nonsense until every row has been edited by hand.
export function seedMid(id: number, cost: number): number {
    return Math.max(1, Math.trunc(SNAPSHOT.get(id) ?? cost));
}

export function addRow(book: PriceBook, id: number, seedCost: number): PriceBook {
    if (rowOf(book, id)) {
        return book;
    }
    return withRows(book, [...book.rows, { id, mid: seedMid(id, seedCost), cap: 0, buying: true, selling: true }]);
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

export type SortKey = 'name' | 'category' | 'buy' | 'sell' | 'cap';
export type SortDir = 'asc' | 'desc';

/** The book as the table shows it: one shelf or all of them, in the operator's chosen order. */
// Why: sorting a copy leaves the book's own order alone, so what is saved never depends on how it was last looked at.
export function viewRows(rows: readonly DisplayRow[], shelf: Category | 'All', key: SortKey, dir: SortDir): DisplayRow[] {
    const kept = shelf === 'All'
        ? [...rows]
        : rows.filter(r => (shelf === 'Popular' ? r.popular : r.category === shelf));
    const sign = dir === 'asc' ? 1 : -1;
    return kept.sort((a, b) => {
        if (key === 'name') {
            return sign * (a.name.localeCompare(b.name) || a.id - b.id);
        }
        if (key === 'category') {
            return sign * (a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
        }
        return sign * (a[key] - b[key]) || a.name.localeCompare(b.name);
    });
}

/** Clicking the column you are already sorted by turns it around. */
export function nextSort(current: { key: SortKey; dir: SortDir }, clicked: SortKey): { key: SortKey; dir: SortDir } {
    if (current.key !== clicked) {
        return { key: clicked, dir: clicked === 'name' || clicked === 'category' ? 'asc' : 'desc' };
    }
    return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/** Add every item given that the book does not already carry, each seeded at its own value. */
export function addRows(book: PriceBook, items: readonly { id: number; cost: number }[]): PriceBook {
    let next = book;
    for (const item of items) {
        next = addRow(next, item.id, item.cost);
    }
    return next;
}


const MILLION = 1_000_000;
/** Below this, the exact number is short enough to read and to type. */
const SHORTEN_FROM = 10_000;

/** A price as the boxes show it: 9999, 999K, 1.25M. */
export function formatPrice(n: number): string {
    const value = Math.trunc(n);
    if (!Number.isFinite(value)) {
        return '0';
    }
    const sign = value < 0 ? '-' : '';
    const size = Math.abs(value);
    if (size >= MILLION) {
        // Why: two places is what separates 1.25M from 1.3M, and trailing zeros only add width.
        return `${sign}${(size / MILLION).toFixed(2).replace(/\.?0+$/, '')}M`;
    }
    if (size >= SHORTEN_FROM) {
        return `${sign}${Math.floor(size / 1000)}K`;
    }
    return `${sign}${size}`;
}

/** Read a box back, in any of the forms it can show or a person can type. */
// Why: the box is editable, so whatever it displays has to be something it also accepts.
export function parsePrice(text: string): number | null {
    const cleaned = text.trim().replace(/[\s,]/g, '');
    if (cleaned.length === 0) {
        return null;
    }
    const m = /^(-?\d*\.?\d+)([km])?$/i.exec(cleaned);
    if (!m) {
        return null;
    }
    const scale = m[2] === undefined ? 1 : m[2].toLowerCase() === 'k' ? 1000 : MILLION;
    const value = Number(m[1]) * scale;
    return Number.isFinite(value) ? Math.trunc(value) : null;
}
