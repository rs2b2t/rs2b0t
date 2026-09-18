import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { StartupProvision } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

afterEach(() => mock.restore());

function fixture() {
    const bot = new GatheringBot();
    bot['bankTeleport'] = 'Varrock';
    bot['teleCasts'] = 2;
    bot['startupProvisionPending'] = true;
    bot['gearKeep'] = bot['rebuildGearKeep']();
    const pack = new Map<string, number>();
    const state = { open: false, ready: true, close: true, full: false, stock: true };
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(Inventory, 'count').mockImplementation(name => pack.get(name) ?? 0);
    spyOn(Inventory, 'isFull').mockImplementation(() => state.full);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'loaded').mockImplementation(() => state.ready);
    spyOn(Bank, 'snapshotReady').mockImplementation(() => state.ready);
    const open = spyOn(Banking, 'open').mockImplementation(async () => { state.open = true; return true; });
    const scriptOpen = spyOn(bot, 'openScriptBank').mockImplementation(async () => { state.open = true; return true; });
    spyOn(bot, 'waitBankReady').mockImplementation(async () => state.ready);
    spyOn(bot, 'closeScriptBank').mockImplementation(async () => { if (state.close) state.open = false; return state.close; });
    const deposit = spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        for (const [name] of pack) if (match(name, 0)) pack.delete(name);
        state.full = false;
    });
    const withdraw = spyOn(Bank, 'withdraw').mockImplementation(async (name, op) => {
        if (!state.stock) return false;
        const amount = op === 'Withdraw-10' ? 10 : op === 'Withdraw-5' ? 5 : 1;
        pack.set(name, (pack.get(name) ?? 0) + amount);
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const stop = spyOn(ScriptRunner, 'stop').mockImplementation(() => {});
    return { bot, pack, state, open, scriptOpen, deposit, withdraw, stop, task: new StartupProvision(bot) };
}

test('startup uses an accessible bank before attempting the camp bank route', async () => {
    const { bot, open, scriptOpen, pack } = fixture();
    await bot.runStartupProvision();
    expect(open).toHaveBeenCalled();
    expect(scriptOpen).not.toHaveBeenCalled();
    expect(pack.get('Air rune')).toBe(6);
    expect(pack.get('Fire rune')).toBe(2);
    expect(pack.get('Law rune')).toBe(2);
});

test('startup frees pack slots while preserving existing teleport runes', async () => {
    const { bot, pack, state, deposit } = fixture();
    pack.set('Coal', 27);
    pack.set('Law rune', 2);
    state.full = true;
    await bot.runStartupProvision();
    expect(deposit).toHaveBeenCalled();
    expect(pack.has('Coal')).toBe(false);
    expect(pack.get('Law rune')).toBe(2);
    expect(bot.startupProvisionNeeded()).toBe(false);
});

test('startup does not withdraw against a bank that never loaded', async () => {
    const { bot, state, withdraw } = fixture();
    state.ready = false;
    await bot.runStartupProvision();
    expect(withdraw).not.toHaveBeenCalled();
    expect(bot.startupProvisionNeeded()).toBe(true);
});

test('a failed close keeps startup pending after the runes arrive', async () => {
    const { bot, state } = fixture();
    state.close = false;
    await bot.runStartupProvision();
    expect(bot.startupProvisionNeeded()).toBe(true);
});

test('empty rune stock consumes one open and three withdrawal passes', async () => {
    const { bot, state, open, task, withdraw } = fixture();
    state.stock = false;
    for (let turn = 0; turn < 5 && task.validate(); turn++) await task.execute();
    expect(bot.startupProvisionNeeded()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledTimes(9);
});

test('existing rune stacks can be replenished in a full inventory', async () => {
    const { bot, pack, state } = fixture();
    state.open = true;
    state.full = true;
    pack.set('Air rune', 1);
    pack.set('Fire rune', 1);
    pack.set('Law rune', 1);
    await bot.withdrawTripProvisionsAtBank();
    expect(pack.get('Air rune')).toBe(6);
});

test('one funded cast does not trigger a partial rune top-up', async () => {
    const { bot, pack, state, withdraw } = fixture();
    state.open = true;
    pack.set('Air rune', 3);
    pack.set('Fire rune', 1);
    pack.set('Law rune', 1);
    await bot.withdrawTripProvisionsAtBank();
    expect(withdraw).not.toHaveBeenCalled();
});

test('startup with a junk pack defers the camp purge until provisioning', async () => {
    const { bot, open, scriptOpen } = fixture();
    bot.settings = new SettingsBag({ location: 'Southwest Varrock Mine', rocks: ['Tin'], withdrawCoins: 100 });
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3093, 3243, 0));
    spyOn(Game, 'setAutoRetaliate').mockReturnValue(true);
    spyOn(Inventory, 'items').mockReturnValue([new InvItem({ id: 453, name: 'Coal', count: 1, slot: 0, comId: 3214, ops: [] })]);
    await bot.onStart();
    expect(bot.startupProvisionNeeded()).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(scriptOpen).not.toHaveBeenCalled();
});

test('missing startup coins stop after the withdrawal budget', async () => {
    const { bot, state, stop, task } = fixture();
    state.stock = false;
    bot['withdrawCoinsTarget'] = 100;
    spyOn(bot, 'withdrawCoinsFor').mockResolvedValue(false);
    await task.execute();
    expect(stop).toHaveBeenCalled();
    expect(bot.startupProvisionNeeded()).toBe(false);
});

test('startup stops after repeatedly failing to close the bank', async () => {
    const { state, stop, task } = fixture();
    state.close = false;
    for (let turn = 0; turn < 5 && task.validate(); turn++) await task.execute();
    expect(stop).toHaveBeenCalledWith('startup provisioning could not close the bank');
});

test('trip coins top up only the missing amount and stay out of deposits', async () => {
    const { bot, pack, state } = fixture();
    bot['bankTeleport'] = 'Off';
    bot['withdrawCoinsTarget'] = 100;
    bot['gearKeep'] = bot['rebuildGearKeep']();
    state.open = true;
    pack.set('Coins', 40);
    spyOn(Bank, 'count').mockReturnValue(1000);
    const withdraw = spyOn(Bank, 'withdrawX').mockImplementation(async (name, amount) => {
        pack.set(name, (pack.get(name) ?? 0) + amount);
        return true;
    });
    await bot.withdrawTripProvisionsAtBank();
    expect(withdraw).toHaveBeenCalledWith('Coins', 60);
    expect(pack.get('Coins')).toBe(100);
    expect(bot.restockDepositMatcher()('Coins')).toBe(false);
});

test('trip provisioning waits for an unsynchronized bank without spending withdrawal attempts', async () => {
    const { bot, state, withdraw } = fixture();
    state.open = true;
    state.ready = false;
    bot['withdrawCoinsTarget'] = 100;
    const coins = spyOn(bot, 'withdrawCoinsFor').mockResolvedValue(false);
    await bot.withdrawTripProvisionsAtBank();
    expect(coins).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
});

test('trip provisioning handles a synchronized empty bank as missing stock', async () => {
    const { bot, state, withdraw } = fixture();
    state.open = true;
    state.stock = false;
    bot['withdrawCoinsTarget'] = 100;
    spyOn(Bank, 'loaded').mockReturnValue(false);
    const coins = spyOn(bot, 'withdrawCoinsFor').mockResolvedValue(false);
    await bot.withdrawTripProvisionsAtBank();
    expect(coins).toHaveBeenCalledTimes(1);
    expect(withdraw).toHaveBeenCalledTimes(3);
});
