import { resolvePrices as resolveOrderbookPrices } from './orderbook-format.js';
import { rowOf, type PriceBook, type PriceRow } from './priceBook.js';

export interface ResolvedPrices {
    buy: number;
    sell: number;
}

export function resolvePrices(book: PriceBook, row: PriceRow): ResolvedPrices {
    return resolveOrderbookPrices(book, row);
}

export function rowValid(book: PriceBook, row: PriceRow): boolean {
    if (row.cap < 0 || row.mid < 1) {
        return false;
    }
    if (row.buy !== undefined && row.sell !== undefined && row.sell <= row.buy) {
        return false;
    }
    const { buy, sell } = resolvePrices(book, row);
    return buy >= 1 && sell > buy;
}

export function tradeRow(book: PriceBook, id: number, side: 'buying' | 'selling'): PriceRow | null {
    const row = rowOf(book, id);
    return row && row[side] && rowValid(book, row) ? row : null;
}
