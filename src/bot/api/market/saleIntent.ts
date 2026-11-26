import { displayName, type Catalog } from './catalog.js';
import type { PriceBook } from './priceBook.js';
import { resolvePrices, tradeRow } from './prices.js';
import type { MarketSet } from './sets.js';

export type SellIntent = { maxQty: number } & ({ itemId: number } | { set: MarketSet });

export function saleItems(intent: SellIntent): readonly number[] {
    return 'set' in intent ? intent.set.itemIds : [intent.itemId];
}

export function saleName(cat: Catalog, intent: SellIntent): string {
    return 'set' in intent ? intent.set.name : displayName(cat, intent.itemId);
}

export function saleStock(intent: SellIntent, count: (id: number) => number): number {
    return Math.min(...saleItems(intent).map(count));
}

export function saleQuantity(requested: number, stock: number, price: number, maxTradeValue: number): number {
    return Math.min(requested, stock, Math.floor(maxTradeValue / price));
}

export function salePrice(book: PriceBook, intent: SellIntent): number | null {
    let total = 0;
    for (const id of saleItems(intent)) {
        const row = tradeRow(book, id, 'selling');
        if (!row) return null;
        total += resolvePrices(book, row).sell;
    }
    return total > 0 ? total : null;
}
