import { describe, expect, test } from 'bun:test';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import { buildCatalog } from '#/bot/api/market/catalog.js';
import { COINS, PACK, TRADE_SLOTS, acceptAction, decide, dumpables, heldWithOffer, planPile, type Dumpable } from '#/bot/scripts/JiveMarketDumper/logic.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

const IRON = 440;
const IRON_NOTE = 441;
const YEW = 1515;
const YEW_NOTE = 1516;
const SCIM = 1333;
/** Untradeable, the one thing a dump has to leave behind. */
const CAPE = 1019;

const CAT = buildCatalog([
    rec(IRON, 'Iron ore'),
    rec(IRON_NOTE, 'Iron ore', { certlink: IRON, certtemplate: 799, stackable: true }),
    rec(YEW, 'Yew logs'),
    rec(YEW_NOTE, 'Yew logs', { certlink: YEW, certtemplate: 799, stackable: true }),
    rec(COINS, 'Coins', { stackable: true }),
    rec(SCIM, 'Rune scimitar'),
    rec(CAPE, 'Cape')
]);

describe('dumpables', () => {
    test('takes every tradeable item, whatever the maker pays for it', () => {
        const list = dumpables([{ id: YEW, count: 500 }, { id: IRON, count: 1000 }, { id: SCIM, count: 2 }], CAT);
        expect(list.map(d => [d.displayName, d.count])).toEqual([['Iron ore', 1000], ['Rune scimitar', 2], ['Yew logs', 500]]);
    });

    test('leaves coins and anything the engine will not trade', () => {
        expect(dumpables([{ id: COINS, count: 50_000 }, { id: YEW, count: 1 }], CAT).map(d => d.displayName)).toEqual(['Yew logs']);
    });

    test('folds a noted bank row onto its item and says what a note-mode withdrawal lands as', () => {
        const list = dumpables([{ id: IRON_NOTE, count: 50 }, { id: IRON, count: 2 }], CAT);
        expect(list).toEqual([{ id: IRON, name: 'Iron ore', displayName: 'Iron ore', notedId: IRON_NOTE, count: 52 }]);
    });

    test('an item with no noted form still goes, one slot a unit', () => {
        expect(dumpables([{ id: SCIM, count: 3 }], CAT)[0]).toMatchObject({ id: SCIM, notedId: null, count: 3 });
    });
});

describe('planPile', () => {
    const yews: Dumpable = { id: YEW, name: 'Yew logs', displayName: 'Yew logs', notedId: YEW_NOTE, count: 500 };
    const iron: Dumpable = { id: IRON, name: 'Iron ore', displayName: 'Iron ore', notedId: IRON_NOTE, count: 1000 };
    const scims: Dumpable = { id: SCIM, name: 'Rune scimitar', displayName: 'Rune scimitar', notedId: null, count: 40 };

    test('a noted stack is one slot however deep, so a whole bank of them rides in one trip', () => {
        expect(planPile([yews, iron])).toEqual([yews, iron]);
    });

    test('an unnotable item takes a slot a unit and is cut to what fits', () => {
        expect(planPile([scims], 6)).toEqual([{ ...scims, count: 6 }]);
        expect(planPile([yews, scims], 4)).toEqual([yews, { ...scims, count: 3 }]);
    });

    // Why: the maker has to have room for every slot it is handed, and it keeps only a few free beside its coin float, so a trip stops well short of a full pack.
    test('stops at twenty slots by default, short of the pack', () => {
        const many: Dumpable[] = Array.from({ length: 40 }, (_, i) => ({ id: 3000 + i, name: `Thing ${i}`, displayName: `Thing ${i}`, notedId: 4000 + i, count: 1 }));
        expect(TRADE_SLOTS).toBe(20);
        expect(TRADE_SLOTS).toBeLessThan(PACK);
        expect(planPile(many)).toHaveLength(TRADE_SLOTS);
        expect(planPile([scims])).toEqual([{ ...scims, count: TRADE_SLOTS }]);
    });

    test('takes nothing with no room', () => {
        expect(planPile([yews], 0)).toEqual([]);
    });
});

describe('decide', () => {
    test('owns an open window first, then goes to the maker with a pile, then banks', () => {
        expect(decide({ tradeActive: true, pile: 0 })).toEqual({ kind: 'trade' });
        expect(decide({ tradeActive: false, pile: 3 })).toEqual({ kind: 'approach' });
        expect(decide({ tradeActive: false, pile: 0 })).toEqual({ kind: 'bank' });
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
