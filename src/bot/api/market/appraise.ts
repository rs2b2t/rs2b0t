import { unnotedId, type Catalog } from './catalog.js';
import { rowOf, type PriceBook } from './priceBook.js';
import { resolvePrices, rowValid } from './prices.js';
import { roomUnderCap } from './ledger.js';
import { formatGp, truncateChat } from './chatProtocol.js';
import type { OfferItem, ValuedLine } from './quote.js';

/** What the customer asked for in chat. Only the selling direction needs one. */
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

export interface Appraisal {
    kind: 'buy' | 'sell' | 'nothing';
    /** unnoted id -> units the bot should have on its own side. */
    owe: Map<number, number>;
    /** gp value of the exchange. */
    total: number;
    lines: ValuedLine[];
    /** Named so the customer can pull them back out before the bot accepts. */
    ignored: { name: string; count: number }[];
    /** Set when the bot trimmed the deal rather than refused it. */
    note: string | null;
}

function units(item: OfferItem): number {
    return Math.max(1, item.count);
}

/** Merge a trade side onto unnoted ids, keeping coins separate. */
function fold(cat: Catalog, items: readonly OfferItem[], coinId: number): {
    goods: Map<number, { name: string; count: number }>;
    coins: number;
} {
    const goods = new Map<number, { name: string; count: number }>();
    let coins = 0;
    for (const item of items) {
        if (item.id === coinId) {
            coins += units(item);
            continue;
        }
        const id = unnotedId(cat, item.id);
        const name = cat.byId.get(id)?.name ?? item.name ?? `item ${id}`;
        const prev = goods.get(id);
        goods.set(id, { name, count: (prev?.count ?? 0) + units(item) });
    }
    return { goods, coins };
}

/**
 * What the bot should have on its own side, given what the customer has on theirs.
 * Why: derived every beat rather than remembered, so nothing can go stale and running the beat twice changes nothing.
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
    const ignored: { name: string; count: number }[] = [];

    if (intent !== null) {
        for (const [, g] of goods) {
            ignored.push(g);
        }
        return sellTo(book, cat, desk, intent, coins, ignored);
    }

    if (coins > 0) {
        ignored.push({ name: 'coins', count: coins });
    }
    return buyFrom(book, desk, coinId, goods, ignored);
}

function buyFrom(
    book: PriceBook,
    desk: DeskState,
    coinId: number,
    goods: Map<number, { name: string; count: number }>,
    ignored: { name: string; count: number }[]
): Appraisal {
    const lines: ValuedLine[] = [];
    let total = 0;
    let note: string | null = null;

    for (const [id, { name, count }] of goods) {
        const row = rowOf(book, id);
        if (!row || !row.buying || !rowValid(book, row)) {
            ignored.push({ name, count });
            continue;
        }
        const take = Math.min(count, roomUnderCap(row.cap, desk.held(id), 0));
        if (take < count) {
            ignored.push({ name, count: count - take });
            note = 'some of that is over my cap';
        }
        if (take <= 0) {
            continue;
        }
        const { buy } = resolvePrices(book, row);
        lines.push({ id, name, count: take, each: buy, value: take * buy });
        total += take * buy;
    }

    const ceiling = Math.min(desk.purse, book.maxTradeValue);
    if (total > ceiling) {
        return trimBuy(lines, ignored, ceiling, coinId);
    }
    if (total <= 0) {
        return { kind: 'nothing', owe: new Map(), total: 0, lines, ignored, note };
    }
    return { kind: 'buy', owe: new Map([[coinId, total]]), total, lines, ignored, note };
}

/**
 * Drop entire lines until the bill fits what the bot can pay.
 * Why: paying for part of a stack means picking which units, and the trade window has no way to say so.
 */
function trimBuy(
    lines: ValuedLine[],
    ignored: { name: string; count: number }[],
    ceiling: number,
    coinId: number
): Appraisal {
    const kept: ValuedLine[] = [];
    let total = 0;
    for (const line of [...lines].sort((a, b) => b.value - a.value)) {
        if (total + line.value <= ceiling) {
            kept.push(line);
            total += line.value;
        } else {
            ignored.push({ name: line.name, count: line.count });
        }
    }
    const note = `I can only cover ${formatGp(total)}gp of that`;
    if (total <= 0) {
        return { kind: 'nothing', owe: new Map(), total: 0, lines: kept, ignored, note };
    }
    return { kind: 'buy', owe: new Map([[coinId, total]]), total, lines: kept, ignored, note };
}

function sellTo(
    book: PriceBook,
    cat: Catalog,
    desk: DeskState,
    intent: SellIntent,
    coins: number,
    ignored: { name: string; count: number }[]
): Appraisal {
    const row = rowOf(book, intent.itemId);
    const name = cat.byId.get(intent.itemId)?.name ?? `item ${intent.itemId}`;
    if (!row || !row.selling || !rowValid(book, row)) {
        return { kind: 'nothing', owe: new Map(), total: 0, lines: [], ignored, note: `I don't sell ${name} any more` };
    }

    const { sell } = resolvePrices(book, row);
    const affordable = Math.floor(coins / sell);
    const qty = Math.min(affordable, intent.maxQty, desk.available(intent.itemId), Math.floor(book.maxTradeValue / sell));

    if (qty <= 0) {
        const note = coins <= 0
            ? `put up coins and I'll count them: ${name} is ${formatGp(sell)}ea`
            : `${formatGp(coins)}gp is short of one ${name} at ${formatGp(sell)}`;
        return { kind: 'nothing', owe: new Map(), total: 0, lines: [], ignored, note };
    }

    const total = qty * sell;
    if (coins > total) {
        ignored.push({ name: 'coins', count: coins - total });
    }
    return {
        kind: 'sell',
        owe: new Map([[intent.itemId, qty]]),
        total,
        lines: [{ id: intent.itemId, name, count: qty, each: sell, value: total }],
        ignored,
        note: qty < intent.maxQty ? `that is all the ${name} ${formatGp(coins)}gp covers` : null
    };
}

/** One line, so the customer sees what their side is worth before the bot accepts anything. */
export function describeAppraisal(a: Appraisal): string {
    const parts = a.lines.map(l => `${l.name} x${formatGp(l.count)} = ${formatGp(l.value)}.`);
    for (const i of a.ignored) {
        parts.push(`${formatGp(i.count)} ${i.name}: not counted, keep them.`);
    }
    if (a.note) {
        parts.push(`${a.note}.`);
    }
    if (parts.length === 0) {
        // Why: an empty window is the moment a customer is most likely to be lost, so it gets the instruction rather than a shrug.
        return 'Put items in and I price them as you go. To buy, say what you want first.';
    }
    const tail = a.kind === 'nothing' ? '' : ` Total ${formatGp(a.total)}gp.`;
    return truncateChat(`${parts.join(' ')}${tail}`);
}
