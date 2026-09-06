import { describe, expect, test } from 'bun:test';
import { SELL_STACK_STEP, shopOpBatch } from '#/bot/api/shop/Shop.js';

const SELL_OPS = [null, 'Value', 'Sell 1', 'Sell 5', 'Sell 10'];
const BUY_OPS = [null, 'Value', 'Buy 1', 'Buy 5', 'Buy 10'];

describe('shopOpBatch', () => {
    test('sells 25 as 10+10+5 in one tick, not three ticks of one click', () => {
        const batch = shopOpBatch(SELL_OPS, 'sell', 25);
        expect(batch.map(i => SELL_OPS[i])).toEqual(['Sell 10', 'Sell 10', 'Sell 5']);
    });

    test('caps a tick at five user-event ops (50 via 10s)', () => {
        expect(shopOpBatch(BUY_OPS, 'buy', 100).length).toBe(5);
        expect(shopOpBatch(BUY_OPS, 'buy', 100).every(i => BUY_OPS[i] === 'Buy 10')).toBe(true);
    });

    test('uses 1 when less than 5 remain', () => {
        expect(shopOpBatch(SELL_OPS, 'sell', 3).map(i => SELL_OPS[i])).toEqual(['Sell 1', 'Sell 1', 'Sell 1']);
    });
});

// Why: JiveShilo sells its catch by clicking Sell 10 until the stack is gone rather than working the split out, since the engine caps the click at what the slot holds.
describe('selling a stack in tens', () => {
    test('one Sell 10 is what a ten-sized ask asks for', () => {
        expect(shopOpBatch(SELL_OPS, 'sell', SELL_STACK_STEP)).toEqual([shopOpBatch(SELL_OPS, 'sell', 10)[0]]);
        expect(shopOpBatch(SELL_OPS, 'sell', SELL_STACK_STEP)).toHaveLength(1);
    });

    test('the step is ten, the biggest the shop offers', () => {
        expect(SELL_STACK_STEP).toBe(10);
    });

    test('a shop without a Sell 10 falls back to what it has, so the loop still moves', () => {
        expect(shopOpBatch(['Value', 'Sell 1'], 'sell', SELL_STACK_STEP).length).toBeGreaterThan(0);
    });
});
