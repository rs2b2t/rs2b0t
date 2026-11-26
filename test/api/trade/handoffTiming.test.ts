import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import Tile from '#/bot/geometry/Tile.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { runHandoff } from '#/bot/api/trade/PartnerHandoff.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';

afterEach(() => mock.restore());

test('accepts the confirm screen on arrival and returns once the received item lands', async () => {
    let tick = 0;
    const accepts: number[] = [];
    const confirm = () => accepts.length === 1 && tick >= 2;
    const received = () => accepts.length === 2 && tick > accepts[1];
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Trade, 'partner').mockReturnValue('Partner');
    spyOn(Trade, 'active').mockImplementation(() => accepts.length === 0 || confirm());
    spyOn(Trade, 'onConfirmScreen').mockImplementation(confirm);
    spyOn(Trade, 'theirOffer').mockReturnValue([{ id: 1, count: 1, name: 'Key' }]);
    spyOn(Trade, 'myOffer').mockReturnValue([]);
    spyOn(Trade, 'accept').mockImplementation(async () => { accepts.push(tick); return true; });
    spyOn(Inventory, 'countById').mockImplementation(() => Number(received()));
    const poll = async (ready: () => boolean, budget: number) => {
        for (let i = 0; i < budget && !ready(); i++) tick++;
        return ready();
    };
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(poll);
    spyOn(Execution, 'delayUntil').mockImplementation(ready => poll(ready, 10));

    expect(await runHandoff({ partner: 'Partner', rendezvous: new Tile(1, 1, 0), id: 1,
        name: 'Key', giving: false, label: 'receive', log: () => {} })).toBe(true);
    expect(accepts).toEqual([0, 2]);
    expect(tick).toBe(3);
});
