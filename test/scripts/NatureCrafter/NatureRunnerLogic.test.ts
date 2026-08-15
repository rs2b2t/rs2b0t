import { expect, test, describe } from 'bun:test';

import { planStoreStep, offerCount, coinTargetFor, shortRouteWithdraw, RUNES, RUNE_OPTIONS, DEFAULT_RUNE, TRADE_CAP, BUY_ONLY_STOCK, LOW_COINS, MIN_COIN_TARGET } from '#/bot/scripts/NatureCrafter/NatureRunnerLogic.js';

describe('planStoreStep (one store action per pass, re-planned against live stock)', () => {
    test('holding the full trade cap = done, regardless of stock', () => {
        expect(planStoreStep(0, 40, TRADE_CAP)).toEqual({ op: 'done' });
        expect(planStoreStep(100, 0, TRADE_CAP + 1)).toEqual({ op: 'done' });
    });

    test('over-stocked shop (>30) = buy-only, never sell', () => {
        expect(planStoreStep(BUY_ONLY_STOCK + 1, 40, 0)).toEqual({ op: 'buy', n: 25 });
        expect(planStoreStep(100, 40, 10)).toEqual({ op: 'buy', n: 15 });
    });

    test('at exactly 30 stock the deficit rule applies (deficit 0, so buy)', () => {
        expect(planStoreStep(BUY_ONLY_STOCK, 40, 0)).toEqual({ op: 'buy', n: 25 });
    });

    test('empty shop = classic sell-then-buy-back', () => {
        expect(planStoreStep(0, 40, 0)).toEqual({ op: 'sell', n: 25 });
        expect(planStoreStep(25, 15, 0)).toEqual({ op: 'buy', n: 25 });
    });

    test('partial stock sells only the deficit', () => {
        expect(planStoreStep(20, 40, 0)).toEqual({ op: 'sell', n: 5 });
    });

    test('shop ran dry mid-buy: sell exactly what is missing to reach 25', () => {
        expect(planStoreStep(0, 40, 17)).toEqual({ op: 'sell', n: 8 });
    });

    test('sell is bounded by the notes actually held', () => {
        expect(planStoreStep(0, 3, 0)).toEqual({ op: 'sell', n: 3 });
    });

    test('no notes left: buy whatever stock exists', () => {
        expect(planStoreStep(10, 0, 0)).toEqual({ op: 'buy', n: 10 });
    });

    test('nothing to sell, nothing to buy = done (leave with a partial load)', () => {
        expect(planStoreStep(0, 0, 10)).toEqual({ op: 'done' });
    });
});

describe('RUNES (one row per rune the pair can run)', () => {
    test('nature keeps the long route: Ardougne bank, ship, Jiminua un-noting', () => {
        const nature = RUNES['Nature runes'];
        expect(nature.rune).toBe('Nature rune');
        expect(nature.talisman).toBe('Nature talisman');
        expect(nature.level).toBe(44);
        expect([nature.ruins.x, nature.ruins.z]).toEqual([2865, 3022]);
        expect([nature.runnerBank.x, nature.runnerBank.z]).toEqual([2655, 3283]);
        expect(nature.unnote?.npc).toBe('Jiminua');
    });

    test('air is the short route: Falador East bank, no un-noting leg', () => {
        const air = RUNES['Air runes'];
        expect(air.rune).toBe('Air rune');
        expect(air.talisman).toBe('Air talisman');
        expect(air.level).toBe(1);
        expect([air.ruins.x, air.ruins.z]).toEqual([2983, 3288]);
        expect([air.runnerBank.x, air.runnerBank.z]).toEqual([3013, 3355]);
        expect(air.masterBank).toEqual(air.runnerBank);
        expect(air.unnote).toBeNull();
    });

    test('the dropdown offers exactly the configured runes, defaulting to the original nature loop', () => {
        expect(RUNE_OPTIONS).toEqual(['Nature runes', 'Air runes']);
        expect(RUNES[DEFAULT_RUNE]).toBeDefined();
        expect(DEFAULT_RUNE).toBe('Nature runes');
    });
});

describe('shortRouteWithdraw (air: one trade window per trip, never a leftover)', () => {
    test('default takes exactly a trade load', () => {
        expect(shortRouteWithdraw(0, 1000, 28)).toBe(TRADE_CAP);
    });

    test('a withdrawEss carried over from the noting route must not fill the pack', () => {
        // Why: 28 withdrawn against a 25 trade cap leaves 3 behind and costs a second altar trip.
        expect(shortRouteWithdraw(28, 1000, 28)).toBe(TRADE_CAP);
        expect(shortRouteWithdraw(1000, 1000, 28)).toBe(TRADE_CAP);
    });

    test('a smaller withdrawEss still wins', () => {
        expect(shortRouteWithdraw(10, 1000, 28)).toBe(10);
    });

    test('bounded by what the bank and the pack actually have', () => {
        expect(shortRouteWithdraw(0, 7, 28)).toBe(7);
        expect(shortRouteWithdraw(0, 1000, 3)).toBe(3);
        expect(shortRouteWithdraw(0, 0, 28)).toBe(0);
    });

    test('an unread pack (0 slots) falls back to the cap rather than withdrawing nothing', () => {
        expect(shortRouteWithdraw(0, 1000, 0)).toBe(TRADE_CAP);
    });
});

describe('coinTargetFor (a restock must clear the low-coin floor by a whole trip)', () => {
    test('keeps a generous setting as-is', () => {
        expect(coinTargetFor(10000)).toBe(10000);
    });

    test('a target at or under the floor would ping-pong bank<->boat, so it is raised', () => {
        expect(coinTargetFor(LOW_COINS)).toBe(MIN_COIN_TARGET);
        expect(coinTargetFor(0)).toBe(MIN_COIN_TARGET);
        expect(coinTargetFor(-5)).toBe(MIN_COIN_TARGET);
    });

    test('the floor always has room above it for fares plus a buy-back', () => {
        expect(MIN_COIN_TARGET).toBeGreaterThan(LOW_COINS * 2);
    });
});

describe('offerCount (trade-window law: never more than 25)', () => {
    test('caps at TRADE_CAP', () => {
        expect(offerCount(52)).toBe(25);
        expect(offerCount(26)).toBe(25);
    });

    test('offers what is held when under the cap', () => {
        expect(offerCount(17)).toBe(17);
        expect(offerCount(25)).toBe(25);
        expect(offerCount(0)).toBe(0);
    });
});
