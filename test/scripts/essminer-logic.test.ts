import { describe, expect, test } from 'bun:test';
import { BEST_AVAILABLE, ESS_ITEM, PICK_OPTIONS, PICK_TIERS, inEssMine, requiredMiningLevel, resolvePick, withdrawOneOp } from '#/bot/scripts/EssMinerLogic.js';

describe('PICK_TIERS', () => {
    test('best-first with the content levelrequire values (pickaxes.obj)', () => {
        expect(PICK_TIERS.map(t => [t.item, t.level])).toEqual([
            ['Rune pickaxe', 41], ['Adamant pickaxe', 31], ['Mithril pickaxe', 21],
            ['Steel pickaxe', 6], ['Iron pickaxe', 1], ['Bronze pickaxe', 1]
        ]);
    });
    test('dropdown options are Best available + every tier', () => {
        expect(PICK_OPTIONS).toEqual([BEST_AVAILABLE, 'Rune', 'Adamant', 'Mithril', 'Steel', 'Iron', 'Bronze']);
    });
});

describe('requiredMiningLevel', () => {
    test('specific tiers report their gate; Best available and unknowns do not', () => {
        expect(requiredMiningLevel('Rune')).toBe(41);
        expect(requiredMiningLevel('steel')).toBe(6);
        expect(requiredMiningLevel(BEST_AVAILABLE)).toBeNull();
        expect(requiredMiningLevel('Dragon')).toBeNull();
    });
});

describe('resolvePick', () => {
    test('best available prefers the best usable tier that is held', () => {
        expect(resolvePick(BEST_AVAILABLE, 50, ['Bronze pickaxe', 'Rune pickaxe'], []))
            .toEqual({ kind: 'held', item: 'Rune pickaxe' });
    });
    test('best available skips tiers above the mining level', () => {
        expect(resolvePick(BEST_AVAILABLE, 40, ['Rune pickaxe', 'Steel pickaxe'], []))
            .toEqual({ kind: 'held', item: 'Steel pickaxe' });
    });
    test('any held usable tier beats a better one that is only banked', () => {
        expect(resolvePick(BEST_AVAILABLE, 50, ['Bronze pickaxe'], ['Rune pickaxe']))
            .toEqual({ kind: 'held', item: 'Bronze pickaxe' });
    });
    test('nothing held: withdraw the best usable tier from the bank', () => {
        expect(resolvePick(BEST_AVAILABLE, 50, [], ['Bronze pickaxe', 'Adamant pickaxe']))
            .toEqual({ kind: 'withdraw', item: 'Adamant pickaxe' });
    });
    test('nothing anywhere: stop with the usable tier list', () => {
        const res = resolvePick(BEST_AVAILABLE, 5, [], []);
        expect(res.kind).toBe('stop');
        if (res.kind === 'stop') {
            expect(res.reason).toContain('Bronze pickaxe');
            expect(res.reason).not.toContain('Steel pickaxe');
        }
    });
    test('specific tier below the mining level stops with the gate', () => {
        expect(resolvePick('Rune', 40, ['Rune pickaxe'], [])).toEqual(
            { kind: 'stop', reason: 'Mining 41 required for the Rune pickaxe (have 40)' });
    });
    test('specific tier: held wins, then bank, then stop — never a fallback tier', () => {
        expect(resolvePick('Steel', 30, ['Steel pickaxe', 'Rune pickaxe'], [])).toEqual({ kind: 'held', item: 'Steel pickaxe' });
        expect(resolvePick('Steel', 30, ['Bronze pickaxe'], ['Steel pickaxe'])).toEqual({ kind: 'withdraw', item: 'Steel pickaxe' });
        const res = resolvePick('Steel', 30, ['Bronze pickaxe'], ['Rune pickaxe']);
        expect(res.kind).toBe('stop');
    });
    test('name matching is case-insensitive', () => {
        expect(resolvePick(BEST_AVAILABLE, 50, ['rune PICKAXE'], [])).toEqual({ kind: 'held', item: 'Rune pickaxe' });
    });
});

describe('inEssMine', () => {
    test('mapsquare 45_75 boundaries', () => {
        expect(inEssMine(2880, 4800)).toBe(true);
        expect(inEssMine(2943, 4863)).toBe(true);
        expect(inEssMine(2879, 4800)).toBe(false);
        expect(inEssMine(2880, 4799)).toBe(false);
        expect(inEssMine(2944, 4800)).toBe(false);
        expect(inEssMine(3253, 3418)).toBe(false);
    });
});

describe('ESS_ITEM', () => {
    test('matches the blankrune obj display name', () => {
        expect(ESS_ITEM).toBe('Rune essence');
    });
});

describe('withdrawOneOp', () => {
    test('matches the real "Withdraw 1" label (a space)', () => {
        expect(withdrawOneOp(['Withdraw 1'])).toBe('Withdraw 1');
    });
    test('also matches the hyphenated "Withdraw-1" default', () => {
        expect(withdrawOneOp(['Withdraw-1'])).toBe('Withdraw-1');
    });
    test('anchored — never matches "Withdraw 10"/All/X', () => {
        expect(withdrawOneOp(['Withdraw 10', 'Withdraw All', 'Withdraw X'])).toBeNull();
    });
    test('picks "Withdraw 1" out of a realistic op list', () => {
        expect(withdrawOneOp([null, 'Withdraw 5', 'Withdraw 1', 'Withdraw 10', 'Withdraw All', 'Withdraw X'])).toBe('Withdraw 1');
    });
    test('empty op list returns null', () => {
        expect(withdrawOneOp([])).toBeNull();
    });
    test('case-insensitive', () => {
        expect(withdrawOneOp(['WITHDRAW 1'])).toBe('WITHDRAW 1');
    });
});
