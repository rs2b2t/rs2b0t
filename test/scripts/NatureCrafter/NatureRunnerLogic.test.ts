import { expect, test, describe } from 'bun:test';

import { planStoreStep, offerCount, coinTargetFor, shortRouteWithdraw, RUNES, RUNE_OPTIONS, DEFAULT_RUNE, TRADE_CAP, TRADE_ADJACENT, TRADE_NO_WALK, RUNNER_ASK_MS, MASTER_HANDSHAKE_MS, BUY_ONLY_STOCK, LOW_COINS, MIN_COIN_TARGET, SPIDER_SAFE, spiderSafeVia, tradeDelivered, runnerShouldWalkToMeet, runnerMayLeaveAltar, masterPickTradeTarget, masterOfferDecision, tradeWindowIsFor, masterShouldExitTemple, masterShouldEnterAltar, keepNames, isLitter, isEventHeld, isDroppableLitter, runnerShouldRequestTrade } from '#/bot/scripts/NatureCrafter/NatureRunnerLogic.js';

describe('litter keep-list', () => {
    const runnerKeep = keepNames('Nature talisman', null);
    const masterKeep = keepNames('Nature talisman', 'Nature rune');
    test('runners keep coins, essence and the talisman', () => {
        expect(isLitter('Coins', runnerKeep)).toBe(false);
        expect(isLitter('Rune essence', runnerKeep)).toBe(false);
        expect(isLitter('Nature talisman', runnerKeep)).toBe(false);
        expect(isLitter('Nature rune', runnerKeep)).toBe(true);
        expect(isLitter(null, runnerKeep)).toBe(true);
    });
    test('master also keeps the runes it crafts', () => {
        expect(isLitter('Nature rune', masterKeep)).toBe(false);
        expect(isLitter('Kebab', masterKeep)).toBe(true);
    });
    test('Strange box and Lamp belong to RandomEvents, not DropLitter', () => {
        expect(isEventHeld('Strange box')).toBe(true);
        expect(isEventHeld('Lamp')).toBe(true);
        expect(isLitter('Strange box', runnerKeep)).toBe(false);
        expect(isLitter('Lamp', masterKeep)).toBe(false);
        expect(isDroppableLitter('Strange box', runnerKeep, ['Open'])).toBe(false);
        expect(isDroppableLitter('Strange box', runnerKeep, ['Drop'])).toBe(false);
        expect(isDroppableLitter('Kebab', masterKeep, ['Drop'])).toBe(true);
        expect(isDroppableLitter('Kebab', masterKeep, ['Eat'])).toBe(false);
        expect(isDroppableLitter('Coins', runnerKeep, ['Drop'])).toBe(false);
    });
});

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

describe('tradeDelivered', () => {
    test('true only when unnoted essence has left the pack', () => {
        expect(tradeDelivered(25, 0)).toBe(true);
        expect(tradeDelivered(25, 10)).toBe(true);
        expect(tradeDelivered(25, 25)).toBe(false);
        expect(tradeDelivered(0, 0)).toBe(false);
    });
});

describe('runnerShouldWalkToMeet', () => {
    test('walks to the ruins until the master is in sight', () => {
        expect(runnerShouldWalkToMeet(false, false, false, false)).toBe(true);
    });
    test('stands once the master is visible, even if a trade request missed', () => {
        expect(runnerShouldWalkToMeet(true, false, false, false)).toBe(false);
        expect(runnerShouldWalkToMeet(false, true, false, false)).toBe(false);
    });
    test('does not leave the altar to re-path to the ruins', () => {
        expect(runnerShouldWalkToMeet(false, false, true, false)).toBe(false);
    });
    test('still enters the altar when stay-in-altar is on', () => {
        expect(runnerShouldWalkToMeet(false, false, false, true)).toBe(true);
        expect(TRADE_ADJACENT).toBe(2);
        expect(TRADE_NO_WALK).toBe(1);
        expect(RUNNER_ASK_MS).toBe(1800);
    });
});

describe('masterPickTradeTarget', () => {
    const idle = { holdUntil: 0, now: 100 };
    test('answers the runner who asked after the last accept', () => {
        expect(masterPickTradeTarget({ asked: 'mith full', askedAt: 20, lastAcceptAt: 10, askedInRange: true, ...idle })).toBe('mith full');
    });
    test('ignores an ask from before the last accept — that request was cancelled', () => {
        expect(masterPickTradeTarget({ asked: 'mith full', askedAt: 10, lastAcceptAt: 20, askedInRange: true, ...idle })).toBeNull();
    });
    test('does not click someone else while the asker is still walking in', () => {
        expect(masterPickTradeTarget({ asked: 'mith full', askedAt: 20, lastAcceptAt: 10, askedInRange: false, ...idle })).toBeNull();
    });
    test('does not click the nearest body when nobody has a live ask', () => {
        expect(masterPickTradeTarget({ asked: null, askedAt: 0, lastAcceptAt: 0, askedInRange: false, ...idle })).toBeNull();
    });
    test('does not re-click during the handshake hold — that cancels the window', () => {
        expect(masterPickTradeTarget({
            asked: 'mith chain', askedAt: 50, lastAcceptAt: 10, askedInRange: true,
            holdUntil: 40, now: 30
        })).toBeNull();
        expect(masterPickTradeTarget({
            asked: 'mith chain', askedAt: 50, lastAcceptAt: 10, askedInRange: true,
            holdUntil: 40, now: 40
        })).toBe('mith chain');
        expect(MASTER_HANDSHAKE_MS).toBe(3000);
    });
});

describe('runnerShouldRequestTrade', () => {
    test('does not click while the window is open', () => {
        expect(runnerShouldRequestTrade(true, 0, 10_000)).toBe(false);
    });
    test('re-asks only after RUNNER_ASK_MS', () => {
        expect(runnerShouldRequestTrade(false, 1000, 1000 + RUNNER_ASK_MS - 1)).toBe(false);
        expect(runnerShouldRequestTrade(false, 1000, 1000 + RUNNER_ASK_MS)).toBe(true);
    });
});

describe('tradeWindowIsFor', () => {
    test('a blank header still counts as the click we just made', () => {
        expect(tradeWindowIsFor(null, 'Mith Dart')).toBe(true);
    });
    test('a window with someone else is not the click', () => {
        expect(tradeWindowIsFor('Mith Scim', 'Mith Dart')).toBe(false);
        expect(tradeWindowIsFor('Mith Dart', 'Mith Dart')).toBe(true);
    });
});

describe('runnerMayLeaveAltar', () => {
    test('does not portal while the trade window is open', () => {
        expect(runnerMayLeaveAltar(true, 0)).toBe(false);
    });
    test('portals when the pack has no unnoted essence and the window is closed', () => {
        expect(runnerMayLeaveAltar(false, 0)).toBe(true);
        expect(runnerMayLeaveAltar(false, 25)).toBe(false);
    });
});

describe('masterOfferDecision', () => {
    const base = { who: 'Iron Square', isPartner: true, theirEssence: 25, runnerWaiting: true };
    test('accepts a named partner offering essence', () => {
        expect(masterOfferDecision(base)).toBe('accept');
    });
    test('does not decline a blank header — prod lags the name past 8 ticks', () => {
        expect(masterOfferDecision({ who: null, isPartner: false, theirEssence: 25, runnerWaiting: false })).toBe('wait');
        expect(masterOfferDecision({ who: null, isPartner: false, theirEssence: 25, runnerWaiting: true })).toBe('accept');
    });
    test('declines a named stranger', () => {
        expect(masterOfferDecision({ ...base, who: 'Random', isPartner: false, runnerWaiting: false })).toBe('decline');
    });
    test('waits until essence is on their offer', () => {
        expect(masterOfferDecision({ ...base, theirEssence: 0 })).toBe('wait');
    });
});

describe('spiderSafeVia', () => {
    const store = { x: 2767, z: 3122 };
    const ruins = { x: 2865, z: 3022 };

    test('store and altar walks hop via 2790,3094 when not already there', () => {
        expect([SPIDER_SAFE.x, SPIDER_SAFE.z, SPIDER_SAFE.level]).toEqual([2790, 3094, 0]);
        expect(spiderSafeVia({ x: 2767, z: 3122 }, ruins, store, ruins)).toBe(true);
        expect(spiderSafeVia({ x: 2865, z: 3022 }, store, store, ruins)).toBe(true);
    });

    test('skips the hop when already at the destination or the waypoint', () => {
        expect(spiderSafeVia({ x: 2865, z: 3022 }, ruins, store, ruins)).toBe(false);
        expect(spiderSafeVia({ x: 2790, z: 3094 }, ruins, store, ruins)).toBe(false);
    });

    test('bank walks do not detour through the spider-safe tile', () => {
        expect(spiderSafeVia({ x: 2865, z: 3022 }, { x: 2655, z: 3283 }, store, ruins)).toBe(false);
    });
});

describe('stay-in-altar master gates', () => {
    test('exits the temple after crafting unless staying (or a bank trip is due)', () => {
        expect(masterShouldExitTemple(true, 0, false, false)).toBe(true);
        expect(masterShouldExitTemple(true, 0, true, false)).toBe(false);
        expect(masterShouldExitTemple(true, 0, true, true)).toBe(true);
        expect(masterShouldExitTemple(true, 5, true, true)).toBe(false);
        expect(masterShouldExitTemple(false, 0, false, false)).toBe(false);
    });

    test('enters empty-handed when staying so it can wait inside', () => {
        expect(masterShouldEnterAltar(false, 0, true, false)).toBe(true);
        expect(masterShouldEnterAltar(false, 0, false, false)).toBe(false);
        expect(masterShouldEnterAltar(false, 10, false, false)).toBe(true);
        expect(masterShouldEnterAltar(true, 10, true, false)).toBe(false);
    });
    test('does not re-enter empty-handed when a bank trip is due', () => {
        expect(masterShouldEnterAltar(false, 0, true, true)).toBe(false);
        expect(masterShouldEnterAltar(false, 10, true, true)).toBe(true);
    });
});
