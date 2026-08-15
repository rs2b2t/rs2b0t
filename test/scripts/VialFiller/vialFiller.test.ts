import { describe, expect, test } from 'bun:test';
import { isShopRun, vialsToBuy } from '#/bot/scripts/VialFiller/VialFillerLogic.js';
import { BANK_STANDS, VIAL_FILLER_SETTINGS } from '#/bot/scripts/VialFiller/VialFiller.js';

describe('VialFiller restock cadence', () => {
    test('never shops before the bank/fountain loop has completed a trip', () => {
        expect(isShopRun(0, true, 5)).toBe(false);
    });

    test('shops on every Nth completed trip', () => {
        const shopped = [];
        for (let runs = 0; runs <= 12; runs++) {
            if (isShopRun(runs, true, 5)) {
                shopped.push(runs);
            }
        }
        expect(shopped).toEqual([5, 10]);
    });

    test('stays off entirely when the option is disabled', () => {
        for (let runs = 0; runs <= 20; runs++) {
            expect(isShopRun(runs, false, 5)).toBe(false);
        }
    });

    test('a zero or negative cadence never divides by zero into every-trip shopping', () => {
        expect(isShopRun(4, true, 0)).toBe(false);
        expect(isShopRun(4, true, -1)).toBe(false);
    });
});

describe('VialFiller restock size', () => {
    test('buys no more than the pack can hold — vials do not stack', () => {
        expect(vialsToBuy(27, 100)).toBe(27);
        expect(vialsToBuy(5, 27)).toBe(5);
    });

    test('buys the requested amount when there is room to spare', () => {
        expect(vialsToBuy(28, 10)).toBe(10);
    });

    test('never asks for a negative or impossible amount', () => {
        expect(vialsToBuy(0, 27)).toBe(0);
        expect(vialsToBuy(-3, 27)).toBe(0);
        expect(vialsToBuy(27, -5)).toBe(0);
    });
});

describe('VialFiller destinations', () => {
    // the fountain is the only Falador water source; these distances are why the
    // west bank is the default
    const FOUNTAIN = { x: 2949, z: 3381 };
    const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

    test('offers both Falador banks and defaults to the one beside the fountain', () => {
        expect(Object.keys(BANK_STANDS).sort()).toEqual(['Falador East', 'Falador West']);
        expect(VIAL_FILLER_SETTINGS.bank.default).toBe('Falador West');
    });

    test('the default bank is far closer to the fountain than the alternative', () => {
        const west = chebyshev(BANK_STANDS['Falador West'], FOUNTAIN);
        const east = chebyshev(BANK_STANDS['Falador East'], FOUNTAIN);
        expect(west).toBeLessThan(20);
        expect(east).toBeGreaterThan(60);
    });

    test('restocking is opt-in, since Taverley is a members area', () => {
        expect(VIAL_FILLER_SETTINGS.buyVials.default).toBe(false);
    });
});
