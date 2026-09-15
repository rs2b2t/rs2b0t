import { describe, expect, test } from 'bun:test';
import { buyoutCost, shopBuyPrice } from '#/bot/api/shop/shopPrice.js';

// Why: `calc_shop_value` raises the price with every one bought, so a shelf costs far more than stock times cost and a trip funded on that arithmetic comes home with change and no goods.
const ROACHEY = { sell: 1000, delta: 10, stock: 1500 };
const FERNAHEI = { sell: 1000, delta: 20, stock: 800 };
const FEATHER = 2;

describe('the engine price curve', () => {
    test('the first one off a full shelf is the price the shop lists', () => {
        expect(shopBuyPrice(FEATHER, 0, ROACHEY.sell, ROACHEY.delta)).toBe(2);
        expect(shopBuyPrice(FEATHER, 0, FERNAHEI.sell, FERNAHEI.delta)).toBe(2);
    });

    test('it climbs with the delta, a gp per fifty at ten and per twenty-five at twenty', () => {
        expect(shopBuyPrice(FEATHER, 50, ROACHEY.sell, ROACHEY.delta)).toBe(3);
        expect(shopBuyPrice(FEATHER, 250, ROACHEY.sell, ROACHEY.delta)).toBe(7);
        expect(shopBuyPrice(FEATHER, 25, FERNAHEI.sell, FERNAHEI.delta)).toBe(3);
        expect(shopBuyPrice(FEATHER, 125, FERNAHEI.sell, FERNAHEI.delta)).toBe(7);
    });

    test('and stops at twelve, where the engine clamps the swing at -5000', () => {
        expect(shopBuyPrice(FEATHER, 500, ROACHEY.sell, ROACHEY.delta)).toBe(12);
        expect(shopBuyPrice(FEATHER, 1499, ROACHEY.sell, ROACHEY.delta)).toBe(12);
        expect(shopBuyPrice(FEATHER, 250, FERNAHEI.sell, FERNAHEI.delta)).toBe(12);
    });

    test('never asks less than a gp, whatever the base cost', () => {
        expect(shopBuyPrice(0, 0)).toBe(1);
    });

    test("Roachey's 1500 feathers run to 15,250gp", () => {
        expect(buyoutCost(FEATHER, ROACHEY.stock, ROACHEY.sell, ROACHEY.delta)).toBe(15_250);
    });

    test("Fernahei's 800 run to 8,225gp, since his delta is twice Roachey's", () => {
        expect(buyoutCost(FEATHER, FERNAHEI.stock, FERNAHEI.sell, FERNAHEI.delta)).toBe(8225);
    });

    // Why: this is the run that bought 571 on 4,000gp seeded, which is what pins the curve to the live engine rather than to a reading of the script.
    test('571 of Roachey cost 4,102gp', () => {
        expect(buyoutCost(FEATHER, 571, ROACHEY.sell, ROACHEY.delta)).toBe(4102);
    });

    test('an empty shelf costs nothing', () => {
        expect(buyoutCost(FEATHER, 0, ROACHEY.sell, ROACHEY.delta)).toBe(0);
    });
});
