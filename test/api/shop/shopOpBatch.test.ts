import { describe, expect, test } from 'bun:test';
import { Shop, SELL_STACK_STEP, shopOpBatch } from '#/bot/api/shop/Shop.js';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { stubProps } from '../../lib/stubSingletons.js';

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

for (const kind of ['buy', 'buyById', 'sell', 'sellAll'] as const) {
    for (const partial of [false, true]) {
        test(`${kind} settles a ${partial ? 'split' : 'complete'} inventory update`, async () => {
            const buying = kind.startsWith('buy');
            const quantity = kind === 'sellAll' ? 10 : 25;
            const direction = buying ? 1 : -1;
            let held = buying ? 0 : quantity;
            let clicks = 0;
            let settleTicks = 0;
            let pending = 0;
            const restores = [
                stubProps(Shop, { isOpen: () => true }),
                stubProps(reader, {
                    shopInv: comId => (!buying && held === 0) ? [] : [{ id: 333, slot: 0, comId, name: 'Trout',
                        count: buying ? 50 : held, ops: buying ? BUY_OPS : SELL_OPS }],
                    inventory: () => [{ id: 333, slot: 0, comId: 3214, name: 'Trout', count: held, ops: [] }]
                }),
                stubProps(Input, { invButton: () => { clicks++; return true; } }),
                stubProps(Execution, {
                    delayUntil: async cond => {
                        pending = partial ? 1 : 0;
                        held += direction * (quantity - pending);
                        return cond();
                    },
                    delayTicks: async ticks => { settleTicks += ticks; held += direction * pending; pending = 0; }
                })
            ];
            try {
                const changed = kind === 'buyById' ? await Shop.buyById(333, quantity)
                    : kind === 'sellAll' ? await Shop.sellAll('Trout')
                        : await Shop[kind]('Trout', quantity);
                expect(changed).toBe(quantity);
                expect(clicks).toBe(kind === 'sellAll' ? 1 : 3);
                expect(settleTicks).toBe(partial ? 1 : 0);
            } finally {
                for (const restore of restores.reverse()) restore();
            }
        });
    }
}
