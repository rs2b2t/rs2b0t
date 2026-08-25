import { describe, expect, test } from 'bun:test';

import { buildCatalog } from '#/bot/api/market/catalog.js';
import {
    decideMarketTrade,
    normaliseOffer,
    offersMatch,
    type TradeExpectation,
    type TradeScreen
} from '#/bot/api/market/driveMarketTrade.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, certlink: -1, certtemplate: -1, ...over };
}

const CAT = buildCatalog([
    rec(440, 'Iron ore'),
    rec(441, 'Iron ore', { certlink: 440, certtemplate: 799, stackable: true }),
    rec(995, 'Coins', { stackable: true }),
    rec(1127, 'Rune platebody')
]);

/** Selling 100 iron ore for 2,000gp. */
const SELL: TradeExpectation = {
    customer: 'Alice',
    give: new Map([[440, 100]]),
    get: new Map([[995, 2000]])
};

function decide(over: Partial<Parameters<typeof decideMarketTrade>[0]> = {}) {
    return decideMarketTrade({
        screen: 'offer' as TradeScreen,
        partnerHeader: 'Alice',
        expect: SELL,
        cat: CAT,
        myOffer: [{ id: 441, name: 'Iron ore', count: 100 }],
        theirOffer: [{ id: 995, name: 'Coins', count: 2000 }],
        confirmMatches: null,
        waitedTicks: 0,
        ...over
    });
}

describe('normaliseOffer', () => {
    test('collapses notes and merges duplicate slots', () => {
        expect([...normaliseOffer(CAT, [
            { id: 441, name: 'Iron ore', count: 60 },
            { id: 440, name: 'Iron ore', count: 40 }
        ])]).toEqual([[440, 100]]);
    });

    test('treats a zero count as one unit', () => {
        expect([...normaliseOffer(CAT, [{ id: 1127, name: 'Rune platebody', count: 0 }])]).toEqual([[1127, 1]]);
    });

    test('an empty offer is an empty map', () => {
        expect(normaliseOffer(CAT, []).size).toBe(0);
    });
});

describe('offersMatch', () => {
    test('exact by id and count', () => {
        expect(offersMatch(new Map([[440, 100]]), new Map([[440, 100]]))).toBe(true);
    });

    test('an extra entry fails', () => {
        expect(offersMatch(new Map([[440, 100], [1127, 1]]), new Map([[440, 100]]))).toBe(false);
    });

    test('a short count fails', () => {
        expect(offersMatch(new Map([[440, 99]]), new Map([[440, 100]]))).toBe(false);
    });

    test('an over count fails too', () => {
        expect(offersMatch(new Map([[440, 101]]), new Map([[440, 100]]))).toBe(false);
    });

    test('two empty maps match', () => {
        expect(offersMatch(new Map(), new Map())).toBe(true);
    });
});

describe('decideMarketTrade', () => {
    test('accepts when both sides match', () => {
        expect(decide()).toEqual({ action: 'accept' });
    });

    test('waits for a blank partner header, then declines', () => {
        expect(decide({ partnerHeader: null })).toEqual({ action: 'wait', reason: 'partner header' });
        expect(decide({ partnerHeader: null, waitedTicks: 9 })).toMatchObject({ action: 'decline' });
    });

    test('declines the wrong partner outright', () => {
        expect(decide({ partnerHeader: 'Mallory' })).toMatchObject({ action: 'decline' });
    });

    test('partner match is case-insensitive', () => {
        expect(decide({ partnerHeader: 'alice' })).toEqual({ action: 'accept' });
    });

    test('offers when its own side is empty', () => {
        expect(decide({ myOffer: [] })).toEqual({ action: 'offer' });
    });

    test('keeps offering while its own side is part-filled', () => {
        expect(decide({ myOffer: [{ id: 440, name: 'Iron ore', count: 40 }] })).toEqual({ action: 'offer' });
    });

    test('declines when its own offer overshoots', () => {
        expect(decide({ myOffer: [{ id: 440, name: 'Iron ore', count: 200 }] })).toMatchObject({ action: 'decline' });
    });

    test('declines when its own offer holds something it never quoted', () => {
        expect(decide({
            myOffer: [
                { id: 440, name: 'Iron ore', count: 100 },
                { id: 1127, name: 'Rune platebody', count: 1 }
            ]
        })).toMatchObject({ action: 'decline' });
    });

    test('waits while their side is still short', () => {
        expect(decide({ theirOffer: [{ id: 995, name: 'Coins', count: 500 }] })).toEqual({
            action: 'wait',
            reason: 'their offer'
        });
    });

    test('declines an extra item slipped into their side', () => {
        expect(decide({
            theirOffer: [
                { id: 995, name: 'Coins', count: 2000 },
                { id: 1127, name: 'Rune platebody', count: 1 }
            ]
        })).toMatchObject({ action: 'decline' });
    });

    test('declines an overpay it never quoted', () => {
        expect(decide({ theirOffer: [{ id: 995, name: 'Coins', count: 5000 }] })).toMatchObject({ action: 'decline' });
    });

    test('an empty their-side waits rather than declining', () => {
        expect(decide({ theirOffer: [] })).toEqual({ action: 'wait', reason: 'their offer' });
    });

    test('confirm accepts only when the confirm screen itself matched', () => {
        expect(decide({ screen: 'confirm', confirmMatches: true })).toEqual({ action: 'accept' });
    });

    test('confirm waits while the confirm screen has not filled', () => {
        expect(decide({ screen: 'confirm', confirmMatches: null })).toEqual({
            action: 'wait',
            reason: 'confirm screen'
        });
    });

    // Why: the classic scam is swapping the offer after the first accept, and only the confirm screen sees the swap.
    test('swap after accept is caught on the confirm screen', () => {
        expect(decide({
            screen: 'confirm',
            confirmMatches: false,
            myOffer: [{ id: 441, name: 'Iron ore', count: 100 }],
            theirOffer: [{ id: 995, name: 'Coins', count: 2000 }]
        })).toMatchObject({ action: 'decline' });
    });

    test('the confirm screen still checks the partner first', () => {
        expect(decide({ screen: 'confirm', confirmMatches: true, partnerHeader: 'Mallory' })).toMatchObject({
            action: 'decline'
        });
    });

    test('a closed screen decides nothing', () => {
        expect(decide({ screen: 'none' })).toEqual({ action: 'wait', reason: 'no trade screen' });
    });
});
