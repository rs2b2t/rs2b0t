import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import FlaxRunner from '#/bot/scripts/FlaxRunner/FlaxRunner.js';

let bot: FlaxRunner | undefined;
afterEach(() => {
    bot?.disposeSubscriptions();
    mock.restore();
});

async function scenario(walked: boolean, opened: boolean, strings = 1) {
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 2724, z: 3491, level: 0 });
    spyOn(Game, 'tick').mockReturnValue(1);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Trade, 'active').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Inventory, 'used').mockReturnValue(1);
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Bow string' ? strings : 0);
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(walked);
    const open = spyOn(Bank, 'openBooth').mockResolvedValue(opened);
    const deposit = spyOn(Bank, 'depositInventory').mockResolvedValue();
    const close = spyOn(Bank, 'close').mockResolvedValue(true);
    bot = new FlaxRunner();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ mode: 'Spinner' });
    const trip = spyOn(bot, 'countTrip');
    await bot.onStart();
    return { bot, walk, open, deposit, close, trip };
}

test('spinner retries a failed walk without opening, depositing, or counting a trip', async () => {
    const s = await scenario(false, true);
    await s.bot.loop();
    expect(s.open).not.toHaveBeenCalled();
    expect(s.deposit).not.toHaveBeenCalled();
    expect(s.close).not.toHaveBeenCalled();
    expect(s.trip).not.toHaveBeenCalled();
    s.walk.mockResolvedValue(true);
    await s.bot.loop();
    expect(s.deposit).toHaveBeenCalledTimes(1);
    expect(s.trip).toHaveBeenCalledTimes(1);
});

test('spinner retries a failed bank opening without depositing or counting a trip', async () => {
    const s = await scenario(true, false);
    await s.bot.loop();
    expect(s.deposit).not.toHaveBeenCalled();
    expect(s.close).not.toHaveBeenCalled();
    expect(s.trip).not.toHaveBeenCalled();
    s.open.mockResolvedValue(true);
    await s.bot.loop();
    expect(s.deposit).toHaveBeenCalledTimes(1);
    expect(s.trip).toHaveBeenCalledTimes(1);
});

test('spinner deposits strings and counts a successful trip', async () => {
    const s = await scenario(true, true);
    await s.bot.loop();
    expect(s.deposit).toHaveBeenCalledTimes(1);
    expect(s.close).toHaveBeenCalledTimes(1);
    expect(s.trip).toHaveBeenCalledTimes(1);
});

test('spinner clears junk without counting a string trip', async () => {
    const s = await scenario(true, true, 0);
    await s.bot.loop();
    expect(s.deposit).toHaveBeenCalledTimes(1);
    expect(s.trip).not.toHaveBeenCalled();
});
