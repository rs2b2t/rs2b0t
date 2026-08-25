import type { PriceBook, PriceRow } from './priceBook.js';

export interface ResolvedPrices {
    buy: number;
    sell: number;
}

// Why: margin is the TOTAL spread, so it splits either side of mid and a 20% book quotes 90/110 on a 100gp item.
// Why: multiply before dividing. `100 * (1 + 20/200)` is 110.00000000000001, so the ceil overcharges every round number by 1gp.
export function resolvePrices(book: PriceBook, row: PriceRow): ResolvedPrices {
    const m = row.margin ?? book.margin;
    const buy = Math.max(1, row.buy ?? Math.floor((row.mid * (200 - m)) / 200));
    const sell = Math.max(buy + 1, row.sell ?? Math.ceil((row.mid * (200 + m)) / 200));
    return { buy, sell };
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
