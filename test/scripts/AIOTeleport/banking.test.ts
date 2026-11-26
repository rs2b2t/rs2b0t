import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import AIOTeleport from '#/bot/scripts/AIOTeleport/AIOTeleport.js';

afterEach(() => mock.restore());

function setup(ops: string[]) {
    const bot = new AIOTeleport();
    bot.bindLog(() => {});
    spyOn(Bank, 'items').mockReturnValue([{ name: 'Law rune', count: 100, id: 563, slot: 0, comId: 1, ops }]);
    spyOn(Bank, 'count').mockReturnValue(100);
    spyOn(Inventory, 'count').mockReturnValue(0);
    const pause = spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    return { bot, pause };
}

test('a rune batch uses the acknowledged quantity withdrawal', async () => {
    const { bot, pause } = setup(['Withdraw-X', 'Withdraw-All']);
    const withdraw = spyOn(Bank, 'withdrawX').mockResolvedValue(true);
    expect(await bot['withdrawFromBankWithX']('Law rune', 30)).toBe(true);
    expect(withdraw).toHaveBeenCalledWith('Law rune', 30);
    expect(pause).not.toHaveBeenCalled();
});

test('an all-only rune stack waits for the backpack count to change', async () => {
    const { bot, pause } = setup(['Withdraw All']);
    spyOn(Bank, 'withdraw').mockReturnValue(true);
    const ack = spyOn(Execution, 'delayUntil').mockImplementation(async predicate => {
        expect(predicate()).toBe(false);
        spyOn(Inventory, 'count').mockReturnValue(100);
        return predicate();
    });
    expect(await bot['withdrawFromBankWithX']('Law rune', 30)).toBe(true);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
});
