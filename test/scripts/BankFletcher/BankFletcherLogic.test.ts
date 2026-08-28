import { describe, expect, test } from 'bun:test';
import {
    ARROW_PER_ACTION,
    BOW_STRING,
    BOW_STRING_ID,
    EMPTY_READ_LIMIT,
    INSTANT_ACTIONS_PER_TICK,
    LOG_OPTIONS,
    MAKE_X_CAP,
    UNSTACKED_STRING_SLOTS,
    attachPlanFor,
    bankListState,
    batchRideFloor,
    canWithdrawByName,
    countById,
    countByName,
    exactName,
    extraStringSlotsWanted,
    fixedWithdrawClicks,
    hasFletchWork,
    instantActionsFor,
    keepNames,
    knifeProductLevel,
    lastItemById,
    logNameMatches,
    makeBatchCount,
    matchProduct,
    needsRestock,
    nextEmptyReads,
    nextEmptyReadsByKey,
    productKeywords,
    productNeedsDifferentLog,
    shortBowXpHint,
    shouldStopEmpty,
    shouldStopNoProgress,
    stockAction,
    stringIsStacked,
    stringPlanFor,
    stringWithdrawPlan,
    unstrungSlotsWanted,
    workKind
} from '#/bot/scripts/BankFletcher/BankFletcherLogic.js';

describe('logNameMatches — exact, never substring (the maple-shortbow bug)', () => {
    test('"Logs" matches only regular Logs, NOT Maple/Yew/Oak logs', () => {
        expect(logNameMatches('Logs', 'Logs')).toBe(true);
        expect(logNameMatches('Maple logs', 'Logs')).toBe(false);
        expect(logNameMatches('Oak logs', 'Logs')).toBe(false);
        expect(logNameMatches('Yew logs', 'Logs')).toBe(false);
    });
    test('a qualified log matches only itself', () => {
        expect(logNameMatches('Maple logs', 'Maple logs')).toBe(true);
        expect(logNameMatches('Logs', 'Maple logs')).toBe(false);
        expect(logNameMatches('Yew logs', 'Maple logs')).toBe(false);
    });
    test('case- and whitespace-insensitive', () => {
        expect(logNameMatches('maple logs', 'Maple logs')).toBe(true);
        expect(logNameMatches('  Willow logs ', 'Willow logs')).toBe(true);
    });
    test('null/undefined names never match', () => {
        expect(logNameMatches(null, 'Logs')).toBe(false);
        expect(logNameMatches(undefined, 'Logs')).toBe(false);
    });
});

describe('productNeedsDifferentLog — arrow shafts need regular Logs', () => {
    test('arrow shafts + a non-regular log is refused', () => {
        expect(productNeedsDifferentLog('Arrow shafts', 'Maple logs')).toBe(true);
        expect(productNeedsDifferentLog('Arrow shafts', 'Oak logs')).toBe(true);
    });
    test('arrow shafts + regular Logs is fine', () => {
        expect(productNeedsDifferentLog('Arrow shafts', 'Logs')).toBe(false);
    });
    test('bows fletch from any log', () => {
        expect(productNeedsDifferentLog('Short bow', 'Maple logs')).toBe(false);
        expect(productNeedsDifferentLog('Long bow', 'Yew logs')).toBe(false);
    });
});

describe('exactName', () => {
    const knives = [{ name: 'Bronze knife' }, { name: 'Knife' }];

    test('uses Knife rather than an earlier Bronze knife for the default setting', () => {
        expect(exactName(knives, 'Knife')).toEqual({ name: 'Knife' });
    });

    test('does not substitute Bronze knife when Knife is absent', () => {
        expect(exactName([{ name: 'Bronze knife' }], 'Knife')).toBeNull();
    });

    test('is case- and whitespace-insensitive for the required Knife name', () => {
        expect(exactName(knives, ' knife ')).toEqual({ name: 'Knife' });
    });
});

describe('LOG_OPTIONS', () => {
    test('regular Logs is the first (default) option and the qualified logs are present', () => {
        expect(LOG_OPTIONS[0]).toBe('Logs');
        expect(LOG_OPTIONS).toContain('Maple logs');
        expect(LOG_OPTIONS).toContain('Yew logs');
        expect(LOG_OPTIONS).toContain('Willow logs');
    });
});

describe('productKeywords', () => {
    test('known presets map to distinguishing keywords (case-insensitive)', () => {
        expect(productKeywords('Arrow shafts')).toEqual(['shaft', 'arrow']);
        expect(productKeywords('SHORT BOW')).toEqual(['short']);
        expect(productKeywords('  Long bow ')).toEqual(['long']);
    });

    test('an unknown product falls back to itself as one keyword', () => {
        expect(productKeywords('Willow shield')).toEqual(['willow shield']);
    });

    test('empty product yields no keywords', () => {
        expect(productKeywords('   ')).toEqual([]);
    });
});

describe('matchProduct — label-text menu form', () => {
    const labels = ['15 Arrow Shafts', 'Short Bow', 'Long Bow'];

    test('picks Arrow Shafts for the arrow-shafts preset', () => {
        expect(matchProduct(labels, 'Arrow shafts')).toBe('15 Arrow Shafts');
    });
    test('picks Short Bow, not Long Bow', () => {
        expect(matchProduct(labels, 'Short bow')).toBe('Short Bow');
    });
    test('picks Long Bow, not Short Bow', () => {
        expect(matchProduct(labels, 'Long bow')).toBe('Long Bow');
    });
});

describe('matchProduct — item-name menu form', () => {
    const names = ['Arrow shaft', 'Shortbow (u)', 'Longbow (u)'];

    test('shaft keyword matches the singular item name', () => {
        expect(matchProduct(names, 'Arrow shafts')).toBe('Arrow shaft');
    });
    test('short matches Shortbow (u)', () => {
        expect(matchProduct(names, 'Short bow')).toBe('Shortbow (u)');
    });
    test('long matches Longbow (u)', () => {
        expect(matchProduct(names, 'Long bow')).toBe('Longbow (u)');
    });
});

describe('matchProduct — edge cases', () => {
    test('returns null when no option matches', () => {
        expect(matchProduct(['Oak shortbow (u)'], 'Long bow')).toBeNull();
    });
    test('returns null on an empty menu', () => {
        expect(matchProduct([], 'Long bow')).toBeNull();
    });
    test('returns the first matching option when several qualify', () => {
        expect(matchProduct(['Short bow', 'Shortbow (u)'], 'Short bow')).toBe('Short bow');
    });
});

describe('attachPlanFor', () => {
    test('headless arrows: feather onto shaft, level 1', () => {
        expect(attachPlanFor('Headless arrows')).toEqual({
            inputs: ['Feather', 'Arrow shaft'],
            product: 'Headless arrow',
            level: 1,
            perAction: ARROW_PER_ACTION
        });
    });

    test('every tier resolves with the engine table levels', () => {
        const levels: Record<string, number> = { Bronze: 1, Iron: 15, Steel: 30, Mithril: 45, Adamant: 60, Rune: 75 };
        for (const [metal, level] of Object.entries(levels)) {
            const plan = attachPlanFor(`${metal} arrows`)!;
            expect(plan.inputs, metal).toEqual([`${metal} arrowtips`, 'Headless arrow']);
            expect(plan.product, metal).toBe(`${metal} arrow`);
            expect(plan.level, metal).toBe(level);
            expect(plan.perAction, metal).toBe(ARROW_PER_ACTION);
        }
    });

    test('knife and string products resolve to null', () => {
        for (const p of ['Arrow shafts', 'Short bow', 'Long bow', 'String long bow', 'Ogre arrows', '']) {
            expect(attachPlanFor(p), p).toBeNull();
        }
    });
});

describe('makeBatchCount / batchRideFloor — Make-X drains the pack, Make-10 does not', () => {
    test('a 27-log pack (knife in the last slot) types 27, not 10', () => {
        expect(makeBatchCount(27)).toBe(27);
        expect(makeBatchCount(27)).toBeLessThanOrEqual(MAKE_X_CAP);
    });

    test('a single leftover log still types at least 1', () => {
        expect(makeBatchCount(0)).toBe(1);
        expect(makeBatchCount(1)).toBe(1);
    });

    test('never asks the count dialog for more than the cap', () => {
        expect(makeBatchCount(40)).toBe(MAKE_X_CAP);
    });

    test('Make-X rides until the requested count is consumed', () => {
        expect(batchRideFloor(27, 27, true)).toBe(0);
        expect(batchRideFloor(27, 10, true)).toBe(17);
        expect(batchRideFloor(40, MAKE_X_CAP, true)).toBe(10);
    });

    test('the Make-10 fallback rides until the pack is empty', () => {
        expect(batchRideFloor(27, 10, false)).toBe(0);
    });
});

describe('keepNames — knife or bow string stays, attach keeps nothing', () => {
    test('knife products keep only the knife', () => {
        expect(keepNames('knife', 'Knife')).toEqual(['Knife']);
    });
    test('stringing keeps only the bow string', () => {
        expect(keepNames('string', 'Knife')).toEqual([BOW_STRING]);
    });
    test('arrow attach deposits the whole pack', () => {
        expect(keepNames('attach', 'Knife')).toEqual([]);
    });
});

describe('needsRestock / hasFletchWork', () => {
    test('knife products restock when logs or the knife are missing', () => {
        expect(needsRestock({ kind: 'knife', logCount: 0, knifeCount: 1, input0: 0, input1: 0 })).toBe(true);
        expect(needsRestock({ kind: 'knife', logCount: 12, knifeCount: 1, input0: 0, input1: 0 })).toBe(false);
        expect(needsRestock({ kind: 'knife', logCount: 12, knifeCount: 0, input0: 0, input1: 0 })).toBe(true);
    });

    test('knife products need both logs and a knife to fletch', () => {
        expect(hasFletchWork({ kind: 'knife', logCount: 12, knifeCount: 1, input0: 0, input1: 0 })).toBe(true);
        expect(hasFletchWork({ kind: 'knife', logCount: 12, knifeCount: 0, input0: 0, input1: 0 })).toBe(false);
        expect(hasFletchWork({ kind: 'knife', logCount: 0, knifeCount: 1, input0: 0, input1: 0 })).toBe(false);
    });

    test('attach restocks when either input is gone', () => {
        expect(needsRestock({ kind: 'attach', logCount: 0, knifeCount: 0, input0: 0, input1: 80 })).toBe(true);
        expect(needsRestock({ kind: 'attach', logCount: 0, knifeCount: 0, input0: 80, input1: 0 })).toBe(true);
        expect(needsRestock({ kind: 'attach', logCount: 0, knifeCount: 0, input0: 80, input1: 80 })).toBe(false);
    });

    test('stringing restocks when unstrung or string is gone', () => {
        expect(needsRestock({ kind: 'string', logCount: 0, knifeCount: 0, input0: 0, input1: 14 })).toBe(true);
        expect(needsRestock({ kind: 'string', logCount: 0, knifeCount: 0, input0: 80, input1: 0 })).toBe(true);
        expect(needsRestock({ kind: 'string', logCount: 0, knifeCount: 0, input0: 80, input1: 14 })).toBe(false);
    });
});

describe('bank snapshot — a missing name is not an empty bank', () => {
    test('open + not loaded is unready, not empty', () => {
        expect(bankListState(true, false)).toBe('unready');
        expect(bankListState(true, true)).toBe('ready');
        expect(bankListState(false, false)).toBe('closed');
    });

    test('an unready snapshot with no item is a retry, not a stop', () => {
        expect(stockAction({ state: 'unready', hasItem: false, waitTimedOut: false })).toBe('retry-unready');
        expect(stockAction({ state: 'closed', hasItem: false, waitTimedOut: false })).toBe('retry-closed');
    });

    test('a ready snapshot with no item is a confirmed empty', () => {
        expect(stockAction({ state: 'ready', hasItem: false, waitTimedOut: false })).toBe('empty-confirmed');
    });

    test('a timed-out unready snapshot counts toward empty, not an instant stop', () => {
        expect(stockAction({ state: 'unready', hasItem: false, waitTimedOut: true })).toBe('empty-unready');
        expect(nextEmptyReads(0, 'empty-unready')).toBe(1);
        expect(shouldStopEmpty(1)).toBe(false);
        expect(shouldStopEmpty(EMPTY_READ_LIMIT)).toBe(true);
    });

    test('a confirmed empty increments once — the first miss is not a stop', () => {
        expect(nextEmptyReads(0, 'empty-confirmed')).toBe(1);
        expect(shouldStopEmpty(nextEmptyReads(0, 'empty-confirmed'))).toBe(false);
        expect(shouldStopEmpty(nextEmptyReads(EMPTY_READ_LIMIT - 1, 'empty-confirmed'))).toBe(true);
    });

    test('finding the item resets the empty counter', () => {
        expect(stockAction({ state: 'ready', hasItem: true, waitTimedOut: false })).toBe('ok');
        expect(nextEmptyReads(2, 'ok')).toBe(0);
    });

    test('a closed or still-filling window does not increment empty reads', () => {
        expect(nextEmptyReads(1, 'retry-closed')).toBe(1);
        expect(nextEmptyReads(1, 'retry-unready')).toBe(1);
    });

    test('one input ok does not reset another input empty streak', () => {
        let reads: Record<string, number> = {};
        for (let pass = 0; pass < EMPTY_READ_LIMIT; pass++) {
            reads = nextEmptyReadsByKey(reads, 'Feather', 'ok');
            reads = nextEmptyReadsByKey(reads, 'Arrow shaft', 'empty-confirmed');
        }
        expect(reads['Feather']).toBe(0);
        expect(reads['Arrow shaft']).toBe(EMPTY_READ_LIMIT);
        expect(shouldStopEmpty(reads['Arrow shaft'] ?? 0)).toBe(true);
    });
});

describe('shouldStopNoProgress', () => {
    test('zero sent clicks stop immediately, sent-but-rejected clicks stop at the limit', () => {
        expect(shouldStopNoProgress(1, 0)).toBe(true);
        expect(shouldStopNoProgress(1, 5)).toBe(false);
        expect(shouldStopNoProgress(2, 5)).toBe(false);
        expect(shouldStopNoProgress(3, 5)).toBe(true);
    });
});

describe('knifeProductLevel / shortBowXpHint', () => {
    test('willow longbow is 40, short is 35', () => {
        expect(knifeProductLevel('Long bow', 'Willow logs')).toBe(40);
        expect(knifeProductLevel('Short bow', 'Willow logs')).toBe(35);
        expect(knifeProductLevel('Arrow shafts', 'Logs')).toBe(1);
    });

    test('hints only when Short bow is selected and longbow level is already met', () => {
        expect(shortBowXpHint('Short bow', 'Willow logs', 40)).toBe('long pays more XP/h');
        expect(shortBowXpHint('Short bow', 'Willow logs', 39)).toBeNull();
        expect(shortBowXpHint('Long bow', 'Willow logs', 99)).toBeNull();
    });
});

describe('stringPlanFor — willow long, ids from pack/obj.pack', () => {
    test('willow long uses unstrung 58 / strung 847 / bow string 1777 / level 40', () => {
        expect(stringPlanFor('String long bow', 'Willow logs')).toEqual({
            stringName: BOW_STRING,
            stringId: BOW_STRING_ID,
            unstrungId: 58,
            strungId: 847,
            displayName: 'Willow longbow',
            level: 40,
            perAction: 1
        });
    });

    test('willow short uses unstrung 60 / strung 849 / level 35', () => {
        const plan = stringPlanFor('String short bow', 'Willow logs')!;
        expect(plan.unstrungId).toBe(60);
        expect(plan.strungId).toBe(849);
        expect(plan.level).toBe(35);
    });

    test('knife and attach products are not string plans', () => {
        expect(stringPlanFor('Long bow', 'Willow logs')).toBeNull();
        expect(stringPlanFor('Headless arrows', 'Willow logs')).toBeNull();
    });

    test('workKind splits knife / attach / string', () => {
        expect(workKind('Long bow')).toBe('knife');
        expect(workKind('Headless arrows')).toBe('attach');
        expect(workKind('String long bow')).toBe('string');
    });
});

describe('rev 274 name collision — unstrung and strung share Willow longbow', () => {
    const pack = [
        { id: 58, name: 'Willow longbow', count: 14 },
        { id: 847, name: 'Willow longbow', count: 13 },
        { id: BOW_STRING_ID, name: BOW_STRING, count: 80 }
    ];

    test('count-by-name mixes both piles and is the wrong progress signal', () => {
        expect(countByName(pack, 'Willow longbow')).toBe(27);
        expect(countById(pack, 58)).toBe(14);
        expect(countById(pack, 847)).toBe(13);
    });

    test('last unstrung slot is id 58, not the strung pile', () => {
        expect(lastItemById(pack, 58)).toEqual(pack[0]);
        expect(lastItemById(pack, 847)).toEqual(pack[1]);
    });

    test('withdraw-by-name is unsafe when both ids share the display name', () => {
        expect(canWithdrawByName(pack, 58)).toBe(false);
        expect(canWithdrawByName(pack.filter(i => i.id === 58), 58)).toBe(true);
    });
});

describe('instantActionsFor — engine cap of 5 USER_EVENT packets per tick', () => {
    test('stringing (1 per click) sends at most 5', () => {
        expect(instantActionsFor(80, 27, 1)).toBe(INSTANT_ACTIONS_PER_TICK);
        expect(instantActionsFor(80, 3, 1)).toBe(3);
        expect(instantActionsFor(0, 27, 1)).toBe(0);
    });

    test('arrow attach (15 per click) still caps at 5 packets', () => {
        expect(instantActionsFor(100, 100, ARROW_PER_ACTION)).toBe(INSTANT_ACTIONS_PER_TICK);
        expect(instantActionsFor(10, 10, ARROW_PER_ACTION)).toBe(1);
    });
});

describe('string pack loadout — unstackable bow string must not Withdraw-All', () => {
    test('a stack (count > slots) wants one string slot and the rest unstrung', () => {
        expect(stringIsStacked(1000, 1)).toBe(true);
        expect(extraStringSlotsWanted(1, true)).toBe(0);
        expect(unstrungSlotsWanted(1)).toBe(27);
        expect(stringWithdrawPlan(1, true)).toEqual({ stringExact: 0, unstrungAll: true });
        expect(stringWithdrawPlan(0, true)).toEqual({ stringExact: 1, unstrungAll: true });
    });

    test('unstackable strings split the pack 14/14', () => {
        expect(stringIsStacked(14, 14)).toBe(false);
        expect(extraStringSlotsWanted(0, false)).toBe(UNSTACKED_STRING_SLOTS);
        expect(extraStringSlotsWanted(14, false)).toBe(0);
        expect(unstrungSlotsWanted(14)).toBe(14);
    });

    test('empty pack is 14 strings then Withdraw-All unstrung', () => {
        expect(stringWithdrawPlan(0, false)).toEqual({ stringExact: 14, unstrungAll: true });
        expect(fixedWithdrawClicks(14)).toEqual([10, 1, 1, 1, 1]);
        expect(fixedWithdrawClicks(14)).toHaveLength(INSTANT_ACTIONS_PER_TICK);
    });

    test('fixed withdraw clicks skip the X dialog — 10s then 1s', () => {
        expect(fixedWithdrawClicks(0)).toEqual([]);
        expect(fixedWithdrawClicks(1)).toEqual([1]);
        expect(fixedWithdrawClicks(10)).toEqual([10]);
        expect(fixedWithdrawClicks(8)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    });

    test('kept strings only top up to 14, then the other item is still All', () => {
        expect(stringWithdrawPlan(6, false)).toEqual({ stringExact: 8, unstrungAll: true });
        expect(stringWithdrawPlan(14, false)).toEqual({ stringExact: 0, unstrungAll: true });
    });

    test('a bank pile of 500 is not stacked — inventory slots decide, not bank count', () => {
        expect(stringIsStacked(0, 0)).toBe(false);
        expect(stringWithdrawPlan(0, false).stringExact).toBe(UNSTACKED_STRING_SLOTS);
    });
});
