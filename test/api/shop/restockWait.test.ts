import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Shop, buyWithRestockWait } from '#/bot/api/shop/Shop.js';

afterEach(() => mock.restore());

test('buys on the tick the shop restocks', async () => {
    let tick = 0;
    const buys: number[] = [];
    spyOn(Shop, 'isOpen').mockReturnValue(true);
    spyOn(Shop, 'stock').mockImplementation(() => [{ slot: 0, name: 'Eye of newt', count: tick >= 3 ? 10 : 0 }]);
    spyOn(Shop, 'buy').mockImplementation(async (_name, n) => {
        buys.push(tick);
        return tick >= 3 ? n : 0;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async (ready, limit) => {
        while (tick < limit && !ready()) tick++;
        return ready();
    });
    expect(await buyWithRestockWait('Eye of newt', 5, 20)).toBe(5);
    expect(buys).toEqual([0, 3]);
});
