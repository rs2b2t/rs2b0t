import { displayName, unnotedId, type Catalog } from './catalog.js';
import { rowOf, type PriceBook } from './priceBook.js';
import { resolvePrices, rowValid } from './prices.js';
import { formatGp, truncateChat } from './chatProtocol.js';
import type { OfferItem, ValuedLine } from './quote.js';

/** What the customer asked to buy. Only that direction needs one. */
export interface SellIntent {
    itemId: number;
    maxQty: number;
}

/** What the bot can hand over and pay with, right now. */
export interface DeskState {
    available(id: number): number;
    held(id: number): number;
    purse: number;
}

/** The deal: quantity times unit price, on both sides. */
export interface Appraisal {
    kind: 'buy' | 'sell' | 'nothing';
    /** What the bot puts up. */
    owe: Map<number, number>;
    /** What the customer must have up for the deal to be on. */
    want: Map<number, number>;
    total: number;
    lines: ValuedLine[];
    /** Named so the customer can take them back before the bot accepts. */
    ignored: { name: string; count: number }[];
    note: string | null;
}

type Ignored = { name: string; count: number }[];

function nothing(ignored: Ignored, note: string | null): Appraisal {
    return { kind: 'nothing', owe: new Map(), want: new Map(), total: 0, lines: [], ignored, note };
}

/** Merge a trade side onto unnoted ids, keeping coins apart. */
function fold(cat: Catalog, items: readonly OfferItem[], coinId: number) {
    const goods = new Map<number, { name: string; count: number }>();
    let coins = 0;
    for (const item of items) {
        const units = Math.max(1, item.count);
        if (item.id === coinId) {
            coins += units;
            continue;
        }
        const id = unnotedId(cat, item.id);
        const name = cat.byId.has(id) ? displayName(cat, id) : (item.name ?? `item ${id}`);
        goods.set(id, { name, count: (goods.get(id)?.count ?? 0) + units });
    }
    return { goods, coins };
}

/** The unit price, or null when the book will not trade that item that way. */
function priceOf(book: PriceBook, id: number, side: 'buying' | 'selling'): number | null {
    const row = rowOf(book, id);
    if (!row || !rowValid(book, row) || !row[side]) {
        return null;
    }
    const { buy, sell } = resolvePrices(book, row);
    return side === 'buying' ? buy : sell;
}

/**
 * The deal, given what the customer has up and what they asked for.
 * Why: derived every beat rather than remembered, so nothing can go stale and running it twice changes nothing.
 */
export function appraise(input: {
    book: PriceBook;
    cat: Catalog;
    desk: DeskState;
    coinId: number;
    theirOffer: readonly OfferItem[];
    intent: SellIntent | null;
}): Appraisal {
    const { book, cat, desk, coinId, theirOffer, intent } = input;
    const { goods, coins } = fold(cat, theirOffer, coinId);
    const ignored: Ignored = [];

    if (intent) {
        for (const g of goods.values()) {
            ignored.push(g);
        }
        return sale(book, cat, desk, coinId, intent, coins, ignored);
    }

    if (coins > 0) {
        ignored.push({ name: 'coins', count: coins });
    }
    return purchase(book, desk, coinId, goods, ignored);
}

/** They named x, the book says y, they owe x * y. */
function sale(
    book: PriceBook,
    cat: Catalog,
    desk: DeskState,
    coinId: number,
    intent: SellIntent,
    coins: number,
    ignored: Ignored
): Appraisal {
    const name = displayName(cat, intent.itemId);
    const each = priceOf(book, intent.itemId, 'selling');
    if (each === null) {
        return nothing(ignored, `I don't sell ${name} any more`);
    }

    const qty = Math.min(intent.maxQty, desk.available(intent.itemId), Math.floor(book.maxTradeValue / each));
    if (qty <= 0) {
        return nothing(ignored, `I'm out of ${name}`);
    }

    const total = qty * each;
    if (coins > total) {
        ignored.push({ name: 'coins', count: coins - total });
    }
    return {
        kind: 'sell',
        owe: new Map([[intent.itemId, qty]]),
        want: new Map([[coinId, total]]),
        total,
        lines: [{ id: intent.itemId, name, count: qty, each, value: total }],
        ignored,
        note: qty < intent.maxQty ? shortNote(name, desk, intent.itemId) : null
    };
}

/** Short of what was asked for: the bank still holding some is a different thing from being out. */
function shortNote(name: string, desk: DeskState, itemId: number): string {
    return desk.held(itemId) > desk.available(itemId)
        ? `that is all the ${name} I am carrying`
        : `that is all the ${name} I have`;
}

/** They put x up, the book says y, the bot owes x * y. */
function purchase(
    book: PriceBook,
    desk: DeskState,
    coinId: number,
    goods: Map<number, { name: string; count: number }>,
    ignored: Ignored
): Appraisal {
    const lines: ValuedLine[] = [];
    let note: string | null = null;

    for (const [id, { name, count }] of goods) {
        const each = priceOf(book, id, 'buying');
        const row = rowOf(book, id);
        const take = each === null || !row ? 0 : Math.min(count, Math.max(0, row.cap - desk.held(id)));
        if (take < count) {
            ignored.push({ name, count: count - take });
            if (each !== null) {
                note = 'some of that is over my cap';
            }
        }
        if (take > 0 && each !== null) {
            lines.push({ id, name, count: take, each, value: take * each });
        }
    }

    // Why: the window cannot say which units of a stack it is paying for, so over the ceiling the shop bids the ceiling for the pile as it stands and the customer takes items back if they want full price.
    const ceiling = Math.min(desk.purse, book.maxTradeValue);
    const value = lines.reduce((sum, l) => sum + l.value, 0);
    const total = Math.min(value, ceiling);
    if (value > ceiling) {
        note = `max I can offer is ${formatGp(ceiling)}gp per trade`;
    }

    if (total <= 0) {
        return nothing(ignored, note);
    }
    return {
        kind: 'buy',
        owe: new Map([[coinId, total]]),
        want: new Map(lines.map(l => [l.id, l.count])),
        total,
        lines,
        ignored,
        note
    };
}

/** One line, so the customer sees the deal before the bot accepts anything. */
export function describeAppraisal(a: Appraisal): string {
    // Why: the line is cut at the chat limit and two priced lines already reach it, so the reason goes first or goes unread.
    const parts = a.note === null ? [] : [`${a.note}.`];
    parts.push(...a.lines.map(l => `${l.name} x${formatGp(l.count)} = ${formatGp(l.value)}.`));
    for (const i of a.ignored) {
        parts.push(`${formatGp(i.count)} ${i.name}: not counted, keep them.`);
    }
    if (parts.length === 0) {
        // Why: an empty window is when a customer is most likely to be lost, so it teaches rather than shrugs.
        return 'Put items in and I price them as you go. To buy, say what you want first.';
    }
    if (a.kind === 'nothing') {
        return truncateChat(parts.join(' '));
    }
    // Why: on a sale the total is what the customer owes, and saying so is the only prompt for the coins.
    const total = a.kind === 'sell' ? `You owe ${formatGp(a.total)}gp.` : `Total ${formatGp(a.total)}gp.`;
    return truncateChat(`${parts.join(' ')} ${total}`);
}
