import { describe, expect, test } from 'bun:test';
import {
    BOOT_COST,
    canFinishTrip,
    carriedTeleRunes,
    otherSlots,
    pickShopOption,
    providedRunes,
    remainingGp,
    runeWithdraw,
    shopPrefer,
    stillBuying,
    tripComplete,
    tripGp,
    tripQty
} from '#/bot/scripts/ClimbingBoots/ClimbingBootsLogic.js';

describe('trip kit', () => {
    test('a pack with no rune stacks buys 28 pairs for 336gp', () => {
        expect(tripQty(28, 0)).toBe(28);
        expect(tripGp(28)).toBe(336);
        expect(remainingGp(0, 28)).toBe(336);
        expect(remainingGp(27, 28)).toBe(BOOT_COST);
    });

    test('law and water stacks leave 26 boot slots', () => {
        expect(tripQty(28, 2)).toBe(26);
        expect(tripGp(26)).toBe(312);
    });

    test('an air staff drops the air stack so law+water still occupy two slots', () => {
        const provided = providedRunes(['Staff of air']);
        expect([...provided]).toEqual(['Air rune']);
        expect(carriedTeleRunes(provided).map(row => row.rune)).toEqual(['Law rune', 'Water rune']);
        expect(tripQty(28, carriedTeleRunes(provided).length)).toBe(26);
    });

    test('runeWithdraw tops the stack up to casts * perCast', () => {
        expect(runeWithdraw(3, 50, 0)).toBe(150);
        expect(runeWithdraw(1, 50, 20)).toBe(30);
        expect(runeWithdraw(1, 50, 80)).toBe(0);
    });
});

describe('ready to buy', () => {
    test('exact gp and an empty pack is ready', () => {
        expect(canFinishTrip(336, 0, 1, 28, 0)).toBe(true);
        expect(otherSlots(1, 336, 0, 0)).toBe(0);
    });

    test('a junk slot blocks the last-pair coin spend', () => {
        expect(canFinishTrip(336, 0, 2, 28, 0)).toBe(false);
        expect(otherSlots(2, 336, 0, 0)).toBe(1);
    });

    test('the last 12gp with 27 boots and a full pack is still buying', () => {
        expect(stillBuying(12, 27, 28, 28, 28)).toBe(true);
        expect(stillBuying(24, 27, 28, 28, 28)).toBe(false);
        expect(tripComplete(28, 28)).toBe(true);
        expect(tripComplete(27, 28)).toBe(false);
    });
});

describe('Tenzing shop options', () => {
    test('buying prefers the climbing-boot offer', () => {
        const opts = [
            'Can I buy some Climbing boots?',
            'What is this place?',
            'Nothing, thanks!'
        ];
        expect(pickShopOption(opts, shopPrefer(true))).toBe('Can I buy some Climbing boots?');
        expect(pickShopOption(opts, shopPrefer(false))).toBe('Nothing, thanks!');
    });

    test('missing the boot line means Death Plateau is not complete', () => {
        expect(pickShopOption(['Nice to meet you.', 'Nothing, thanks!'], shopPrefer(true))).toBeNull();
    });
});
