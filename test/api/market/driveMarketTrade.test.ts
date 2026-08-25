import { describe, expect, test } from 'bun:test';

import { buildCatalog } from '#/bot/api/market/catalog.js';
import {
    driveMarketTradeBeat,
    type MarketTradeHooks,
    type TradeExpectation
} from '#/bot/api/market/driveMarketTrade.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, certlink: -1, certtemplate: -1, ...over };
}

const CAT = buildCatalog([rec(440, 'Iron ore'), rec(995, 'Coins', { stackable: true })]);

const EXPECT: TradeExpectation = {
    customer: 'Alice',
    give: new Map([[440, 100]]),
    get: new Map([[995, 2000]])
};

function hooks(over: Partial<MarketTradeHooks> = {}): MarketTradeHooks & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        screen: () => 'offer',
        partnerHeader: () => 'Alice',
        myOffer: () => [{ id: 440, name: 'Iron ore', count: 100 }],
        theirOffer: () => [{ id: 995, name: 'Coins', count: 2000 }],
        confirmMatches: () => true,
        offerGive: async () => {
            calls.push('offer');
            return true;
        },
        accept: async () => {
            calls.push('accept');
            return true;
        },
        decline: async () => {
            calls.push('decline');
        },
        log: (m: string) => calls.push(`log:${m}`),
        ...over
    };
}

describe('driveMarketTradeBeat', () => {
    test('accepts a matching offer screen', async () => {
        const h = hooks();
        const decision = await driveMarketTradeBeat(EXPECT, CAT, h, { waitedTicks: 0 });
        expect(decision).toEqual({ action: 'accept' });
        expect(h.calls).toEqual(['accept']);
    });

    test('offers when its own side is empty', async () => {
        const h = hooks({ myOffer: () => [] });
        await driveMarketTradeBeat(EXPECT, CAT, h, { waitedTicks: 0 });
        expect(h.calls).toEqual(['offer']);
    });

    test('waits without touching the client', async () => {
        const h = hooks({ theirOffer: () => [] });
        await driveMarketTradeBeat(EXPECT, CAT, h, { waitedTicks: 0 });
        expect(h.calls).toEqual([]);
    });

    test('declines a stranger exactly once', async () => {
        const h = hooks({ partnerHeader: () => 'Mallory' });
        const decision = await driveMarketTradeBeat(EXPECT, CAT, h, { waitedTicks: 0 });
        expect(decision.action).toBe('decline');
        expect(h.calls.filter(c => c === 'decline')).toHaveLength(1);
    });

    test('a decline logs its reason', async () => {
        const h = hooks({ theirOffer: () => [{ id: 440, name: 'Iron ore', count: 5 }] });
        await driveMarketTradeBeat(EXPECT, CAT, h, { waitedTicks: 0 });
        expect(h.calls.some(c => c.startsWith('log:'))).toBe(true);
    });

    test('counts a blank header toward the wait budget', async () => {
        const state = { waitedTicks: 0 };
        const h = hooks({ partnerHeader: () => null });
        await driveMarketTradeBeat(EXPECT, CAT, h, state);
        expect(state.waitedTicks).toBe(1);
    });

    test('resets the wait budget once the header fills', async () => {
        const state = { waitedTicks: 5 };
        await driveMarketTradeBeat(EXPECT, CAT, hooks(), state);
        expect(state.waitedTicks).toBe(0);
    });

    // Why: confirmMatches costs a screen read, so it must not run while the offer screen is still up.
    test('confirmMatches is only asked on the confirm screen', async () => {
        let asked = 0;
        await driveMarketTradeBeat(EXPECT, CAT, hooks({
            confirmMatches: () => {
                asked++;
                return true;
            }
        }), { waitedTicks: 0 });
        expect(asked).toBe(0);
    });

    test('the confirm screen defers to confirmMatches', async () => {
        const h = hooks({ screen: () => 'confirm', confirmMatches: () => false });
        const decision = await driveMarketTradeBeat(EXPECT, CAT, h, { waitedTicks: 0 });
        expect(decision.action).toBe('decline');
        expect(h.calls).toContain('decline');
    });
});
