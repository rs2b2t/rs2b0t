import { describe, expect, test } from 'bun:test';

import { appraise, describeAppraisal, type Appraisal, type DeskState } from '#/bot/api/market/appraise.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import type { OfferItem } from '#/bot/api/market/quote.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, certlink: -1, certtemplate: -1, ...over };
}

const IRON = 440;
const IRON_NOTE = 441;
const COINS = 995;
const MIND = 558;
const AIR = 556;
const SCIM = 1333;
const JUNK = 1127;

const CAT = buildCatalog([
    rec(IRON, 'Iron ore'),
    rec(IRON_NOTE, 'Iron ore', { certlink: IRON, certtemplate: 799, stackable: true }),
    rec(COINS, 'Coins', { stackable: true }),
    rec(MIND, 'Mind rune', { stackable: true }),
    rec(AIR, 'Air rune', { stackable: true }),
    rec(SCIM, 'Rune scimitar'),
    rec(JUNK, 'Rune platebody')
]);

const BOOK: PriceBook = {
    name: 'demo',
    margin: 20,
    maxTradeValue: 100_000,
    rows: [
        { id: IRON, mid: 20, cap: 1_000, buying: true, selling: true },
        { id: MIND, mid: 4, cap: 100_000, buying: true, selling: true },
        { id: AIR, mid: 3, cap: 100_000, buying: true, selling: true },
        { id: SCIM, mid: 15_000, cap: 20, buying: true, selling: true }
    ]
};

function desk(over: Partial<{ have: Record<number, number>; held: Record<number, number>; purse: number }> = {}): DeskState {
    const have = over.have ?? {};
    const held = over.held ?? {};
    return {
        available: id => have[id] ?? 0,
        held: id => held[id] ?? 0,
        purse: over.purse ?? 1_000_000
    };
}

function look(theirOffer: OfferItem[], opts: { desk?: DeskState; intent?: { itemId: number; maxQty: number } | null; book?: PriceBook } = {}): Appraisal {
    return appraise({
        book: opts.book ?? BOOK,
        cat: CAT,
        desk: opts.desk ?? desk(),
        coinId: COINS,
        theirOffer,
        intent: opts.intent ?? null
    });
}

function item(id: number, name: string, count: number): OfferItem {
    return { id, name, count };
}

describe('buying: the bot prices what is in front of it', () => {
    test('a single stack', () => {
        const a = look([item(IRON, 'Iron ore', 100)]);
        expect(a.kind).toBe('buy');
        expect([...a.owe]).toEqual([[COINS, 1800]]);
        expect(a.total).toBe(1800);
    });

    // Why: the customer's example, and the reason the window has to be priced rather than quoted.
    test('a mixed pile is one bill', () => {
        const a = look([
            item(MIND, 'Mind rune', 500),
            item(AIR, 'Air rune', 300),
            item(SCIM, 'Rune scimitar', 1)
        ]);
        expect(a.total).toBe(500 * 3 + 300 * 2 + 13_500);
        expect([...a.owe]).toEqual([[COINS, a.total]]);
        expect(a.lines).toHaveLength(3);
    });

    test('noted and unnoted of one row merge', () => {
        const a = look([item(IRON, 'Iron ore', 40), item(IRON_NOTE, 'Iron ore', 60)]);
        expect(a.lines).toHaveLength(1);
        expect(a.lines[0].count).toBe(100);
    });

    test('running the same beat twice changes nothing', () => {
        const side = [item(MIND, 'Mind rune', 500), item(SCIM, 'Rune scimitar', 1)];
        expect(look(side)).toEqual(look(side));
    });

    test('an empty side owes nothing', () => {
        const a = look([]);
        expect(a.kind).toBe('nothing');
        expect(a.owe.size).toBe(0);
    });
});

describe('buying: coins are ignored and named', () => {
    // Why: both sides hand over their window at confirm, so ignoring coins costs the customer them.
    test('coins are excluded from the bill and called out', () => {
        const a = look([item(IRON, 'Iron ore', 100), item(COINS, 'Coins', 500)]);
        expect(a.total).toBe(1800);
        expect(a.ignored).toContainEqual({ name: 'coins', count: 500 });
    });

    test('the description tells the customer to take them back', () => {
        const a = look([item(IRON, 'Iron ore', 100), item(COINS, 'Coins', 500)]);
        expect(describeAppraisal(a)).toBe(
            'Iron ore x100 = 1,800. 500 coins: not counted, keep them. Total 1,800gp.'
        );
    });

    test('coins alone with no intent buy nothing', () => {
        expect(look([item(COINS, 'Coins', 5000)]).kind).toBe('nothing');
    });
});

describe('buying: what it will not take', () => {
    test('an unpriced item is ignored and named', () => {
        const a = look([item(IRON, 'Iron ore', 10), item(JUNK, 'Rune platebody', 1)]);
        expect(a.total).toBe(180);
        expect(a.ignored).toContainEqual({ name: 'Rune platebody', count: 1 });
    });

    test('units past the cap are ignored', () => {
        const a = look([item(IRON, 'Iron ore', 100)], { desk: desk({ held: { [IRON]: 950 } }) });
        expect(a.lines[0].count).toBe(50);
        expect(a.ignored).toContainEqual({ name: 'Iron ore', count: 50 });
    });

    test('a full cap takes nothing of that row', () => {
        const a = look([item(IRON, 'Iron ore', 100)], { desk: desk({ held: { [IRON]: 1000 } }) });
        expect(a.kind).toBe('nothing');
    });

    test('a row switched off for buying is ignored', () => {
        const off = { ...BOOK, rows: BOOK.rows.map(r => (r.id === IRON ? { ...r, buying: false } : r)) };
        expect(look([item(IRON, 'Iron ore', 10)], { book: off }).kind).toBe('nothing');
    });
});

describe('buying: it never offers more than it has', () => {
    test('a thin purse drops entire lines, biggest first', () => {
        const a = look(
            [item(SCIM, 'Rune scimitar', 1), item(IRON, 'Iron ore', 100)],
            { desk: desk({ purse: 5_000 }) }
        );
        expect(a.total).toBe(1800);
        expect(a.lines.map(l => l.id)).toEqual([IRON]);
        expect(a.ignored).toContainEqual({ name: 'Rune scimitar', count: 1 });
        expect(a.note).toContain('1,800gp');
    });

    test('the per-trade ceiling trims the same way', () => {
        const tight = { ...BOOK, maxTradeValue: 5_000 };
        const a = look([item(SCIM, 'Rune scimitar', 1), item(IRON, 'Iron ore', 100)], { book: tight });
        expect(a.total).toBe(1800);
    });

    test('an empty purse buys nothing at all', () => {
        expect(look([item(IRON, 'Iron ore', 100)], { desk: desk({ purse: 0 }) }).kind).toBe('nothing');
    });
});

describe('selling: coins on their side buy what they cover', () => {
    const intent = { itemId: IRON, maxQty: 100 };
    const stocked = desk({ have: { [IRON]: 5_000 } });

    test('exact money buys the lot', () => {
        const a = look([item(COINS, 'Coins', 2200)], { intent, desk: stocked });
        expect(a.kind).toBe('sell');
        expect([...a.owe]).toEqual([[IRON, 100]]);
        expect(a.total).toBe(2200);
    });

    // Why: short money buying fewer units is the point of pricing the window live.
    test('short money buys fewer', () => {
        const a = look([item(COINS, 'Coins', 1100)], { intent, desk: stocked });
        expect([...a.owe]).toEqual([[IRON, 50]]);
        expect(a.total).toBe(1100);
    });

    test('the remainder above a whole unit is named, not pocketed quietly', () => {
        const a = look([item(COINS, 'Coins', 2210)], { intent, desk: stocked });
        expect([...a.owe]).toEqual([[IRON, 100]]);
        expect(a.ignored).toContainEqual({ name: 'coins', count: 10 });
    });

    test('it never hands over more than the customer asked for', () => {
        const a = look([item(COINS, 'Coins', 100_000)], { intent, desk: stocked });
        expect([...a.owe]).toEqual([[IRON, 100]]);
    });

    test('it never hands over more than it holds', () => {
        const a = look([item(COINS, 'Coins', 2200)], { intent, desk: desk({ have: { [IRON]: 30 } }) });
        expect([...a.owe]).toEqual([[IRON, 30]]);
    });

    test('too little money buys nothing, and says the unit price', () => {
        const a = look([item(COINS, 'Coins', 5)], { intent, desk: stocked });
        expect(a.kind).toBe('nothing');
        expect(a.note).toContain('22');
    });

    test('no money yet is a prompt, not a refusal', () => {
        const a = look([], { intent, desk: stocked });
        expect(a.kind).toBe('nothing');
        expect(a.note).toContain('put up coins');
    });

    test('goods on their side during a sale are ignored and named', () => {
        const a = look([item(COINS, 'Coins', 2200), item(JUNK, 'Rune platebody', 1)], { intent, desk: stocked });
        expect([...a.owe]).toEqual([[IRON, 100]]);
        expect(a.ignored).toContainEqual({ name: 'Rune platebody', count: 1 });
    });

    test('a row switched off for selling mid-window stops the sale', () => {
        const off = { ...BOOK, rows: BOOK.rows.map(r => (r.id === IRON ? { ...r, selling: false } : r)) };
        const a = look([item(COINS, 'Coins', 2200)], { intent, desk: stocked, book: off });
        expect(a.kind).toBe('nothing');
        expect(a.note).toContain("don't sell");
    });
});

describe('describeAppraisal', () => {
    test('a plain purchase', () => {
        expect(describeAppraisal(look([item(IRON, 'Iron ore', 100)]))).toBe('Iron ore x100 = 1,800. Total 1,800gp.');
    });

    test('an empty window says so without a total', () => {
        expect(describeAppraisal(look([]))).toBe('Nothing I trade in that offer.');
    });

    test('every line fits the chat limit', () => {
        const a = look([
            item(MIND, 'Mind rune', 500),
            item(AIR, 'Air rune', 300),
            item(SCIM, 'Rune scimitar', 1),
            item(JUNK, 'Rune platebody', 1),
            item(COINS, 'Coins', 900)
        ]);
        expect(describeAppraisal(a).length).toBeLessThanOrEqual(80);
    });
});
