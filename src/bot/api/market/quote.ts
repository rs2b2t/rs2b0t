import { unnotedId, type Catalog } from './catalog.js';
import { rowOf, type PriceBook } from './priceBook.js';
import { resolvePrices } from './prices.js';
import { roomUnderCap, type Ledger } from './ledger.js';
import { formatGp, truncateChat } from './chatProtocol.js';

export interface OfferItem {
    id: number;
    name: string | null;
    count: number;
}

export interface ValuedLine {
    id: number;
    name: string;
    count: number;
    each: number;
    value: number;
}

export interface Valuation {
    total: number;
    coins: number;
    lines: ValuedLine[];
    unpriced: { name: string; count: number }[];
    overCap: { name: string; count: number }[];
}

export function coinsIn(items: readonly OfferItem[], coinId: number): number {
    return items.filter(i => i.id === coinId).reduce((s, i) => s + units(i), 0);
}

// Why: an unstackable trade slot reports count 0, so a raw sum values a rune platebody at nothing.
function units(item: OfferItem): number {
    return Math.max(1, item.count);
}

export function valueOffer(
    book: PriceBook,
    cat: Catalog,
    ledger: Ledger,
    items: readonly OfferItem[],
    coinId: number
): Valuation {
    const merged = new Map<number, { name: string; count: number }>();
    let coins = 0;

    for (const item of items) {
        if (item.id === coinId) {
            coins += units(item);
            continue;
        }
        const id = unnotedId(cat, item.id);
        const name = cat.byId.get(id)?.name ?? item.name ?? `item ${id}`;
        const prev = merged.get(id);
        merged.set(id, { name, count: (prev?.count ?? 0) + units(item) });
    }

    const lines: ValuedLine[] = [];
    const unpriced: { name: string; count: number }[] = [];
    const overCap: { name: string; count: number }[] = [];
    let total = 0;

    for (const [id, { name, count }] of merged) {
        const row = rowOf(book, id);
        if (!row || !row.buying) {
            unpriced.push({ name, count });
            continue;
        }
        const take = Math.min(count, roomUnderCap(row.cap, ledger.held(id), 0));
        if (count > take) {
            overCap.push({ name, count: count - take });
        }
        if (take <= 0) {
            continue;
        }
        const { buy } = resolvePrices(book, row);
        const value = take * buy;
        lines.push({ id, name, count: take, each: buy, value });
        total += value;
    }

    return { total, coins, lines, unpriced, overCap };
}

export function expectedFromValuation(v: Valuation): Map<number, number> {
    return new Map(v.lines.map(l => [l.id, l.count]));
}

export function formatValuation(v: Valuation): string {
    if (v.lines.length === 0 && v.unpriced.length === 0 && v.overCap.length === 0) {
        return 'Nothing I buy in that offer.';
    }
    const parts = [
        ...v.lines.map(l => `${l.name} x${formatGp(l.count)} = ${formatGp(l.value)}.`),
        ...v.unpriced.map(u => `${u.name}: not priced, 0.`),
        ...v.overCap.map(o => `${o.name}: ${formatGp(o.count)} over my cap.`)
    ];
    return truncateChat(`${parts.join(' ')} Total ${formatGp(v.total)}gp.`);
}
