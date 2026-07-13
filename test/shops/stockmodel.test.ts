import { describe, expect, test } from 'bun:test';
import type { ShopItemDef } from '#/bot/shops/types.js';
import { TICK_MS, buyCost, expectedStock, unitPrice, unitsUnderPolicy } from '#/bot/shops/StockModel.js';

const death: ShopItemDef = { obj: 'deathrune', name: 'Death rune', baseline: 1000, restockTicks: 150, cost: 30, stackable: true, members: false };
const fire: ShopItemDef = { obj: 'firerune', name: 'Fire rune', baseline: 2000, restockTicks: 10, cost: 4, stackable: true, members: false };
const SHOP = { sell: 1000, delta: 10 };

describe('expectedStock', () => {
    test('never seen → assume baseline (first lap visits everything)', () => {
        expect(expectedStock(death, undefined, 0)).toBe(1000);
    });
    test('restocks +1 per restockTicks ticks, capped at baseline', () => {
        const seen = { count: 0, atMs: 0 };
        expect(expectedStock(death, seen, 150 * TICK_MS)).toBe(1);
        expect(expectedStock(death, seen, 149 * TICK_MS)).toBe(0);
        expect(expectedStock(death, seen, 10 * 150 * TICK_MS)).toBe(10);
        expect(expectedStock(death, seen, 100_000 * 150 * TICK_MS)).toBe(1000); // cap
    });
    test('overstock decays toward baseline at the same rate', () => {
        const seen = { count: 1010, atMs: 0 };
        expect(expectedStock(death, seen, 150 * TICK_MS * 3)).toBe(1007);
        expect(expectedStock(death, seen, 150 * TICK_MS * 100)).toBe(1000); // floor at baseline
    });
});

describe('unitPrice (engine formula)', () => {
    test('at baseline pays 100%: fire rune = 4gp, death rune = 30gp', () => {
        expect(unitPrice(fire, SHOP, 2000)).toBe(4);
        expect(unitPrice(death, SHOP, 1000)).toBe(30);
    });
    test('price rises ~1%/unit below baseline: death at −100 → 2× = 60gp', () => {
        expect(unitPrice(death, SHOP, 900)).toBe(60);
    });
    test('caps at 6× from −500 down (clamp −5000)', () => {
        expect(unitPrice(death, SHOP, 500)).toBe(180);
        expect(unitPrice(death, SHOP, 1)).toBe(180);
    });
    test('overstock floors at 10% (pct min 100), price min 1gp', () => {
        expect(unitPrice(death, SHOP, 100_000)).toBe(3);   // 10% of 30
        expect(unitPrice(fire, SHOP, 100_000)).toBe(1);    // floor(0.4) → min 1
    });
});

describe('buyCost', () => {
    test('sums per-unit repricing as stock falls', () => {
        // death from stock 1000: units at 1000, 999, 998 → 30 + 30 (pct 1010→30.3 floor 30) + 30
        expect(buyCost(death, SHOP, 1000, 3)).toBe(90);
        // fire whole-stack sanity: monotic, bounded by units × 6×cost
        const full = buyCost(fire, SHOP, 2000, 2000);
        expect(full).toBeGreaterThan(2000 * 4);
        expect(full).toBeLessThanOrEqual(2000 * 24);
    });
    test('more units from lower stock costs more per unit', () => {
        expect(buyCost(death, SHOP, 600, 100)).toBeGreaterThan(buyCost(death, SHOP, 1000, 100));
    });
});

describe('unitsUnderPolicy', () => {
    test('buyout takes everything', () => {
        expect(unitsUnderPolicy({ kind: 'buyout' }, 700, 1000)).toBe(700);
    });
    test('floor 50% buys down to ceil(50% of baseline)', () => {
        expect(unitsUnderPolicy({ kind: 'floor', pct: 50 }, 1000, 1000)).toBe(500);
        expect(unitsUnderPolicy({ kind: 'floor', pct: 50 }, 400, 1000)).toBe(0);   // already below floor
        expect(unitsUnderPolicy({ kind: 'floor', pct: 33 }, 1000, 1000)).toBe(670); // floorCount=ceil(330)=330
    });
});
