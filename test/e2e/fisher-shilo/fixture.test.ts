import { expect, test } from 'bun:test';
import { FUNDING, MINIMUM_TRIP_FUNDING, SHOP_METADATA } from '../../../e2e/fisher-shilo/fixture.js';
import { unitPrice } from '../../../src/bot/api/shop/StockModel.js';

test('funds both complete shelves when stock declines with each purchase', () => {
    let remaining = FUNDING;
    for (const { shop, item } of SHOP_METADATA) {
        for (let stock = item.baseline; stock > 0; stock--) remaining -= unitPrice(item, shop, stock);
    }
    expect(remaining).toBe(0);
});

test('funds 25 vials plus the feather shelf when the pack limits the first trip', () => {
    let remaining = MINIMUM_TRIP_FUNDING;
    for (const { shop, item } of SHOP_METADATA) {
        const quantity = item.stackable ? item.baseline : 25;
        for (let index = 0; index < quantity; index++) remaining -= unitPrice(item, shop, item.baseline - index);
    }
    expect(remaining).toBe(0);
    expect(MINIMUM_TRIP_FUNDING).toBeLessThan(FUNDING);
});
