import { describe, expect, test } from 'bun:test';
import {
    bankPaceTicks,
    cookBatchAfterLoad,
    cookFilterLabel,
    cookPaceTicks,
    cookedNameFromRaw,
    countMatching,
    countRawInBank,
    isBurntFishName,
    isCookedFishName,
    isRawFishName,
    lastMatchingIndex,
    parseAfterCookCycle,
    parseBurntPolicy,
    parseCookMode,
    parsePositiveInt,
    rawMatchesCookFilter,
    resolveCookFishFilter,
    shouldCookThenBank,
    shouldFinishCookLoad,
    shouldKeepDrainingCookBatch,
    shouldStartBankRawCookBatch
} from '#/bot/scripts/GatheringBot/FishCookLogic.js';

describe('parseCookMode / parseBurntPolicy / parseAfterCookCycle', () => {
    test('parses cook mode labels', () => {
        expect(parseCookMode('Off')).toBe('off');
        expect(parseCookMode('Cook then bank')).toBe('cook-then-bank');
        expect(parseCookMode('bank raw then cook')).toBe('bank-raw-then-cook');
        expect(parseCookMode('nope')).toBe('off');
    });

    test('burnt defaults to drop', () => {
        expect(parseBurntPolicy('Drop')).toBe('drop');
        expect(parseBurntPolicy('Bank')).toBe('bank');
        expect(parseBurntPolicy('')).toBe('drop');
    });

    test('after cook cycle defaults to stop', () => {
        expect(parseAfterCookCycle('Stop')).toBe('stop');
        expect(parseAfterCookCycle('Continue')).toBe('continue');
        expect(parseAfterCookCycle('')).toBe('stop');
        expect(parseAfterCookCycle('continue')).toBe('continue');
    });
});

describe('parsePositiveInt / cook fish filter', () => {
    test('parsePositiveInt has no artificial max', () => {
        expect(parsePositiveInt(56, 56)).toBe(56);
        expect(parsePositiveInt(9999, 56)).toBe(9999);
        expect(parsePositiveInt(0, 56)).toBe(1);
        expect(parsePositiveInt(-3, 56)).toBe(1);
        expect(parsePositiveInt('1,200', 56)).toBe(1200);
        expect(parsePositiveInt('  84 ', 56)).toBe(84);
        expect(parsePositiveInt('nope', 56)).toBe(56);
        expect(parsePositiveInt(undefined, 56)).toBe(56);
    });

    test('resolveCookFishFilter', () => {
        expect(resolveCookFishFilter('All raw', '')).toBe('');
        expect(resolveCookFishFilter('Swordfish', '')).toBe('Swordfish');
        expect(resolveCookFishFilter('Tuna', '')).toBe('Tuna');
        expect(resolveCookFishFilter('Custom', 'raw shark')).toBe('raw shark');
        expect(resolveCookFishFilter('Custom', '  ')).toBe('');
    });

    test('rawMatchesCookFilter tuna vs swordfish split', () => {
        expect(rawMatchesCookFilter('Raw swordfish', 'Swordfish')).toBe(true);
        expect(rawMatchesCookFilter('Raw tuna', 'Swordfish')).toBe(false);
        expect(rawMatchesCookFilter('Raw tuna', 'Tuna')).toBe(true);
        expect(rawMatchesCookFilter('Raw swordfish', 'Tuna')).toBe(false);
        expect(rawMatchesCookFilter('Raw lobster', '')).toBe(true);
        expect(rawMatchesCookFilter('Lobster', 'Lobster')).toBe(false); // not raw
        expect(rawMatchesCookFilter('Raw shark', 'raw shark')).toBe(true);
        expect(rawMatchesCookFilter(null, 'Tuna')).toBe(false);
    });

    test('cookFilterLabel', () => {
        expect(cookFilterLabel('')).toBe('all raw');
        expect(cookFilterLabel('Swordfish')).toBe('Swordfish');
    });
});

describe('fish name classifiers', () => {
    test('raw fish', () => {
        expect(isRawFishName('Raw lobster')).toBe(true);
        expect(isRawFishName('raw shark')).toBe(true);
        expect(isRawFishName('Lobster')).toBe(false);
        expect(isRawFishName('Burnt fish')).toBe(false);
        expect(isRawFishName(null)).toBe(false);
    });

    test('burnt fish', () => {
        expect(isBurntFishName('Burnt fish')).toBe(true);
        expect(isBurntFishName('Burnt lobster')).toBe(true);
        expect(isBurntFishName('Lobster')).toBe(false);
        expect(isBurntFishName('Raw lobster')).toBe(false);
    });

    test('cooked fish', () => {
        expect(isCookedFishName('Lobster')).toBe(true);
        expect(isCookedFishName('Swordfish')).toBe(true);
        expect(isCookedFishName('Shrimps')).toBe(true);
        expect(isCookedFishName('Cooked swordfish')).toBe(true);
        expect(isCookedFishName('Raw lobster')).toBe(false);
        expect(isCookedFishName('Burnt fish')).toBe(false);
        expect(isCookedFishName('Coins')).toBe(false);
        expect(isCookedFishName('Cooked meat')).toBe(false);
        expect(isCookedFishName('Meat')).toBe(false);
    });

    test('cookedNameFromRaw strips Raw prefix', () => {
        expect(cookedNameFromRaw('Raw lobster')).toBe('lobster');
        expect(cookedNameFromRaw('Raw Shark')).toBe('Shark');
    });
});

describe('count / last index / bank raw sum', () => {
    const pack = [
        { name: 'Raw lobster' },
        { name: 'Lobster' },
        { name: 'Burnt fish' },
        { name: 'Raw lobster' },
        { name: 'Harpoon' }
    ];

    test('countMatching', () => {
        expect(countMatching(pack, isRawFishName)).toBe(2);
        expect(countMatching(pack, isCookedFishName)).toBe(1);
        expect(countMatching(pack, isBurntFishName)).toBe(1);
    });

    test('lastMatchingIndex prefers last raw', () => {
        expect(lastMatchingIndex(pack, isRawFishName)).toBe(3);
        expect(lastMatchingIndex(pack, n => n === 'Coins')).toBe(-1);
    });

    test('countRawInBank sums stacks for cook filter', () => {
        const bank = [
            { name: 'Raw tuna', count: 40 },
            { name: 'Raw swordfish', count: 28 },
            { name: 'Lobster', count: 10 },
            { name: 'Coins', count: 500 },
            { name: 'Raw lobster', count: 5 }
        ];
        expect(countRawInBank(bank, '')).toBe(40 + 28 + 5);
        expect(countRawInBank(bank, 'Swordfish')).toBe(28);
        expect(countRawInBank(bank, 'Tuna')).toBe(40);
        expect(countRawInBank(bank, 'lobster')).toBe(5);
        expect(countRawInBank(bank, 'shark')).toBe(0);
    });
});

describe('cook flow predicates', () => {
    test('shouldCookThenBank only when full with cookable raw', () => {
        expect(shouldCookThenBank('cook-then-bank', true, 20)).toBe(true);
        expect(shouldCookThenBank('cook-then-bank', false, 20)).toBe(false);
        expect(shouldCookThenBank('cook-then-bank', true, 0)).toBe(false);
        expect(shouldCookThenBank('off', true, 20)).toBe(false);
        expect(shouldCookThenBank('bank-raw-then-cook', true, 20)).toBe(false);
    });

    test('shouldFinishCookLoad while cooking with raw left', () => {
        expect(shouldFinishCookLoad('cook-then-bank', true, 5)).toBe(true);
        expect(shouldFinishCookLoad('cook-then-bank', true, 0)).toBe(false);
        expect(shouldFinishCookLoad('off', true, 5)).toBe(false);
    });

    test('shouldStartBankRawCookBatch uses live bank total vs target', () => {
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', 56, 56)).toBe(true);
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', 55, 56)).toBe(false);
        expect(shouldStartBankRawCookBatch('cook-then-bank', 100, 56)).toBe(false);
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', 10, 0)).toBe(false);
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', 9999, 500)).toBe(true);
    });

    test('harness shape: 973 banked + 27 deposited hits explicit N=1000', () => {
        // fish-bank-raw-cook: cert_raw_lobster 973 → bank, inv 26 raw + catch 1.
        const N = 1000;
        const banked = 973;
        const deposited = 27; // 26 seed + 1 catch
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', banked, N)).toBe(false);
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', banked + deposited, N)).toBe(true);
        expect(countRawInBank([{ name: 'Raw lobster', count: banked + deposited }], 'Lobster')).toBe(1000);
    });

    test('sticky batch: N is entry only — keep draining after withdraw drops below N', () => {
        const N = 5000;
        // Arm when bank hits N
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', 5000, N)).toBe(true);
        // After withdrawing 28, bank has 4972 — must NOT re-require ≥ N
        expect(shouldStartBankRawCookBatch('bank-raw-then-cook', 4972, N)).toBe(false);
        // Sticky flag keeps the drain going regardless of N
        expect(shouldKeepDrainingCookBatch(true, 4972)).toBe(true);
        expect(shouldKeepDrainingCookBatch(true, 1)).toBe(true);
        expect(shouldKeepDrainingCookBatch(true, 0)).toBe(false);
        expect(shouldKeepDrainingCookBatch(false, 4972)).toBe(false);
    });

    test('cookBatchAfterLoad: drain-more until empty, then stop or fish-again', () => {
        // Mid-batch after first 28 of 5000
        expect(cookBatchAfterLoad(4972, 'stop')).toBe('drain-more');
        expect(cookBatchAfterLoad(4972, 'continue')).toBe('drain-more');
        expect(cookBatchAfterLoad(1, 'stop')).toBe('drain-more');
        // Fully drained
        expect(cookBatchAfterLoad(0, 'stop')).toBe('stop');
        expect(cookBatchAfterLoad(0, 'continue')).toBe('fish-again');
    });
});

describe('pace ticks', () => {
    test('cook is 1 tick; bank is 1–2 ticks', () => {
        const low = () => 0.1; // < 0.35 → 2 ticks
        const high = () => 0.9; // ≥ 0.35 → 1 tick
        expect(cookPaceTicks(low)).toBe(1);
        expect(cookPaceTicks(high)).toBe(1);
        expect(bankPaceTicks(low)).toBe(2);
        expect(bankPaceTicks(high)).toBe(1);
    });
});
