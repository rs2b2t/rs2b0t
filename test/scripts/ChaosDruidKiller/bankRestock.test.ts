import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import ChaosDruidKiller from '#/bot/scripts/ChaosDruidKiller/ChaosDruidKiller.js';

afterEach(() => mock.restore());

function setup(ready: boolean, carried = 0) {
    const bot = new ChaosDruidKiller();
    bot.bindLog(() => {});
    const state = { pack: carried, stock: 0 };
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    spyOn(Bank, 'snapshotReady').mockReturnValue(ready);
    spyOn(Bank, 'loaded').mockReturnValue(false);
    spyOn(Bank, 'backpackReady').mockResolvedValue(true);
    spyOn(Inventory, 'count').mockImplementation(() => state.pack);
    spyOn(bot, 'foodCount').mockImplementation(() => state.pack);
    spyOn(Bank, 'count').mockImplementation(() => state.stock);
    const deposit = spyOn(Bank, 'depositInventory').mockImplementation(async () => { state.pack = 0; });
    const withdraw = spyOn(Bank, 'withdrawX').mockImplementation(async (_name, count) => { state.pack = count; return true; });
    spyOn(Bank, 'close').mockResolvedValue(true);
    const wait = spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    return { bot, state, deposit, withdraw, wait };
}

test('a missing bank snapshot leaves the trip eligible for retry', async () => {
    const { bot, deposit } = setup(false);
    expect(await bot.bankAndRestock('prepare-trip')).toBe(false);
    expect(bot.parked).toBe(false);
    expect(deposit).not.toHaveBeenCalled();
});

test('a synchronized empty bank reports the food shortage without a timeout', async () => {
    const { bot, wait } = setup(true);
    expect(await bot.bankAndRestock('prepare-trip')).toBe(false);
    expect(bot.parked).toBe(true);
    expect(wait).not.toHaveBeenCalled();
});

test('food just deposited can supply the whole trip once the bank stock catches up', async () => {
    const { bot, wait, state, withdraw } = setup(true, 12);
    wait.mockImplementation(async predicate => {
        expect(predicate()).toBe(false);
        state.stock = 12;
        return predicate();
    });
    expect(await bot.bankAndRestock('prepare-trip')).toBe(true);
    expect(withdraw).toHaveBeenCalledWith('Lobster', 12);
    expect(bot.parked).toBe(false);
});
