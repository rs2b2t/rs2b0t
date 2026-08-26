import { describe, expect, test } from 'bun:test';

import { offerCovers, offersMatch } from '#/bot/api/market/driveMarketTrade.js';

const side = (entries: [number, number][]): Map<number, number> => new Map(entries);

const COINS = 995;
const IRON = 440;
const JUNK = 1127;

describe('offersMatch', () => {
    test('exact by id and count, with nothing extra', () => {
        expect(offersMatch(side([[IRON, 100]]), side([[IRON, 100]]))).toBe(true);
        expect(offersMatch(side([[IRON, 99]]), side([[IRON, 100]]))).toBe(false);
        expect(offersMatch(side([[IRON, 100], [JUNK, 1]]), side([[IRON, 100]]))).toBe(false);
    });
});

describe('offerCovers', () => {
    // Why: the shop's own side has to be exact, but theirs only has to carry the deal. Holding out for an exact
    // Why: side means a customer who rounds up, or leaves something else in the window, waits out the deadline.
    test('the exact deal is covered', () => {
        expect(offerCovers(side([[COINS, 2200]]), side([[COINS, 2200]]))).toBe(true);
    });

    test('more than the deal is still the deal', () => {
        expect(offerCovers(side([[COINS, 5000]]), side([[COINS, 2200]]))).toBe(true);
    });

    test('short of the deal is not the deal', () => {
        expect(offerCovers(side([[COINS, 2199]]), side([[COINS, 2200]]))).toBe(false);
    });

    test('something else in the window does not stop it settling', () => {
        expect(offerCovers(side([[COINS, 2200], [JUNK, 1]]), side([[COINS, 2200]]))).toBe(true);
    });

    test('a missing id is never covered, however much else is up', () => {
        expect(offerCovers(side([[JUNK, 99]]), side([[COINS, 2200]]))).toBe(false);
        expect(offerCovers(side([]), side([[COINS, 1]]))).toBe(false);
    });

    // Why: nothing wanted is not a deal to accept, it is a window with nothing agreed in it.
    test('wanting nothing is not covered by anything', () => {
        expect(offerCovers(side([[COINS, 5000]]), side([]))).toBe(false);
    });
});
