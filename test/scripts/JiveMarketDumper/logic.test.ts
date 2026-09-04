import { describe, expect, test } from 'bun:test';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import type { PriceBook } from '#/bot/api/market/priceBook.js';
import { COINS, PACK, acceptAction, adapt, decide, heldWithOffer, parseMakerLine, pileValue, planPile, sellables, type Sellable } from '#/bot/scripts/JiveMarketDumper/logic.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

const IRON = 440;
const IRON_NOTE = 441;
const YEW = 1515;
const YEW_NOTE = 1516;
const SCIM = 1333;
const JUNK = 1127;
const DUST = 2000;

const CAT = buildCatalog([
    rec(IRON, 'Iron ore'),
    rec(IRON_NOTE, 'Iron ore', { certlink: IRON, certtemplate: 799, stackable: true }),
    rec(YEW, 'Yew logs'),
    rec(YEW_NOTE, 'Yew logs', { certlink: YEW, certtemplate: 799, stackable: true }),
    rec(COINS, 'Coins', { stackable: true }),
    rec(SCIM, 'Rune scimitar'),
    rec(JUNK, 'Rune platebody'),
    rec(DUST, 'Chocolate dust')
]);

const BOOK: PriceBook = {
    name: 'e2e',
    margin: 20,
    maxTradeValue: 100_000,
    rows: [
        { id: IRON, mid: 20, cap: 4_000, buying: true, selling: true },
        { id: YEW, mid: 320, cap: 2_000, buying: true, selling: true },
        { id: SCIM, mid: 15_000, cap: 20, buying: true, selling: true },
        { id: DUST, mid: 50, cap: 100, buying: false, selling: true }
    ]
};

describe('sellables', () => {
    test('keeps the rows the book buys, priced at the buy side, most valuable line first', () => {
        const list = sellables([{ id: IRON, count: 300 }, { id: YEW, count: 100 }, { id: COINS, count: 5000 }, { id: JUNK, count: 3 }, { id: DUST, count: 40 }], BOOK, CAT);
        expect(list.map(s => [s.name, s.count, s.each])).toEqual([['Yew logs', 100, 288], ['Iron ore', 300, 18]]);
    });

    test('folds noted pack stacks onto the unnoted row and reports the noted id to withdraw as', () => {
        const list = sellables([{ id: IRON_NOTE, count: 50 }, { id: IRON, count: 2 }], BOOK, CAT);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ id: IRON, notedId: IRON_NOTE, count: 52 });
    });

    test('an item with no noted form is still sellable, one slot a unit', () => {
        const [scim] = sellables([{ id: SCIM, count: 3 }], BOOK, CAT);
        expect(scim).toMatchObject({ id: SCIM, notedId: null, count: 3, each: 13_500 });
    });
});

describe('planPile', () => {
    const list: Sellable[] = [
        { id: YEW, name: 'Yew logs', displayName: 'Yew logs', notedId: YEW_NOTE, count: 500, each: 288 },
        { id: IRON, name: 'Iron ore', displayName: 'Iron ore', notedId: IRON_NOTE, count: 1000, each: 18 }
    ];

    test('fills the coin cap from the top of the list, taking a partial stack when a whole one is too dear', () => {
        const pile = planPile(list, 100_000);
        expect(pile.map(l => [l.name, l.count])).toEqual([['Yew logs', 347], ['Iron ore', 3]]);
        expect(pileValue(pile)).toBe(347 * 288 + 3 * 18);
    });

    test('a noted line takes one slot however big, an unnoted line one a unit', () => {
        const scims: Sellable[] = [{ id: SCIM, name: 'Rune scimitar', displayName: 'Rune scimitar', notedId: null, count: 40, each: 13_500 }];
        expect(planPile(scims, 10_000_000, 5)).toEqual([{ ...scims[0], count: 5 }]);
        expect(planPile(list, 10_000_000, 1)).toEqual([{ ...list[0] }]);
    });

    test('is empty when the cap buys nothing or the pack has no room', () => {
        expect(planPile(list, 10)).toEqual([]);
        expect(planPile(list, 100_000, 0)).toEqual([]);
    });

    test('never exceeds the pack', () => {
        const many: Sellable[] = Array.from({ length: 40 }, (_, i) => ({ id: 3000 + i, name: `Thing ${i}`, displayName: `Thing ${i}`, notedId: 4000 + i, count: 1, each: 5 }));
        expect(planPile(many, 1_000_000)).toHaveLength(PACK);
    });
});

describe('parseMakerLine', () => {
    test('reads the ceiling the maker names and the items it will not count', () => {
        expect(parseMakerLine('max I can offer is 100,000gp per trade')).toEqual({ kind: 'ceiling', gp: 100_000 });
        expect(parseMakerLine('3 Rune platebody: not counted, keep them.')).toEqual({ kind: 'ignored', count: 3, name: 'Rune platebody' });
        expect(parseMakerLine('Iron ore x100 = 1,800. Total 1,800gp.')).toBeNull();
        expect(parseMakerLine('Thanks mc. Pleasure doing business.')).toBeNull();
    });
});

describe('decide', () => {
    test('owns an open window first, then goes to the maker with a pile, then banks', () => {
        expect(decide({ tradeActive: true, pileValue: 0 })).toEqual({ kind: 'trade' });
        expect(decide({ tradeActive: false, pileValue: 500 })).toEqual({ kind: 'approach' });
        expect(decide({ tradeActive: false, pileValue: 0 })).toEqual({ kind: 'bank' });
    });
});

describe('adapt', () => {
    test('a named ceiling becomes the cap and named items are dropped', () => {
        const out = adapt({ cap: 200_000, offered: 100_000, notes: [{ kind: 'ceiling', gp: 100_000 }, { kind: 'ignored', count: 3, name: 'Rune platebody' }] });
        expect(out).toEqual({ cap: 100_000, drop: ['Rune platebody'], dropAll: false });
    });

    test('a short offer with no words lowers the cap to what was offered', () => {
        expect(adapt({ cap: 200_000, offered: 62_000, notes: [] })).toEqual({ cap: 62_000, drop: [], dropAll: false });
    });

    test('nothing offered and nothing said drops the whole pile', () => {
        expect(adapt({ cap: 200_000, offered: 0, notes: [] })).toEqual({ cap: 200_000, drop: [], dropAll: true });
    });
});

// Why: the offer screen shuts a tick before the confirm opens, so one dead frame is the handover and the window is only gone once it stays dead.
describe('acceptAction', () => {
    test('accepts whichever screen is up', () => {
        expect(acceptAction({ onOffer: true, onConfirm: false, deadTicks: 0 })).toBe('accept');
        expect(acceptAction({ onOffer: false, onConfirm: true, deadTicks: 0 })).toBe('accept');
    });

    test('waits out the dead frames between the two screens rather than calling the trade over', () => {
        expect(acceptAction({ onOffer: false, onConfirm: false, deadTicks: 1 })).toBe('wait');
        expect(acceptAction({ onOffer: false, onConfirm: false, deadTicks: 3 })).toBe('wait');
    });

    test('past the grace the window really is gone', () => {
        expect(acceptAction({ onOffer: false, onConfirm: false, deadTicks: 4 })).toBe('done');
        expect(acceptAction({ onOffer: false, onConfirm: false, deadTicks: 9 }, 8)).toBe('done');
    });
});

// Why: the pack view hides what is staked, so a pile read from the pack alone reads as empty mid-window and the trade gets declined for nothing.
describe('heldWithOffer', () => {
    test('adds what is already staked to what the pack still holds', () => {
        expect(heldWithOffer([{ id: IRON_NOTE, count: 5 }], [{ id: IRON_NOTE, count: 300 }])).toEqual([{ id: IRON_NOTE, count: 305 }]);
    });

    test('counts a staked line the pack no longer shows at all', () => {
        expect(heldWithOffer([], [{ id: YEW_NOTE, count: 347 }, { id: IRON_NOTE, count: 3 }])).toEqual([
            { id: YEW_NOTE, count: 347 },
            { id: IRON_NOTE, count: 3 }
        ]);
    });

    test('a non-stackable stakes as count-1 slots, which sum', () => {
        expect(heldWithOffer([], [{ id: SCIM, count: 1 }, { id: SCIM, count: 1 }])).toEqual([{ id: SCIM, count: 2 }]);
    });

    test('an empty window is just the pack', () => {
        expect(heldWithOffer([{ id: IRON, count: 2 }], [])).toEqual([{ id: IRON, count: 2 }]);
    });
});
