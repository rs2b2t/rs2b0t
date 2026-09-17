import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveMarketDumper from '#/bot/scripts/JiveMarketDumper/JiveMarketDumper.js';

afterEach(() => {
    mock.restore();
    resetLiveCatalog();
});

test.each(['Shilo Village', 'Duel Arena'])('JiveMarketDumper preserves the bank access for %s', async name => {
    const bank = BANK_LOCATIONS.find(b => b.name === name)!;
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(bank.tile);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(reader, 'objCatalog').mockReturnValue([{ id: 1637, name: 'Sapphire ring', cost: 900, stackable: false, members: false, equippable: true, certlink: -1, certtemplate: -1 }]);
    spyOn(Inventory, 'used').mockReturnValue(0);
    spyOn(Bank, 'isOpen').mockReturnValue(false);
    spyOn(Bank, 'openNearest').mockResolvedValue(false);
    const npc = spyOn(Bank, 'openNpcAccess').mockImplementation(async access => access === bank.npcAccess);
    const object = spyOn(Bank, 'openNearestAccess').mockImplementation(async access => access === bank.access);
    const bot = new JiveMarketDumper();
    bot.settings = new SettingsBag({ maker: 'test maker', bank: name });
    bot.bindLog(() => {});
    await bot.onStart();
    expect(await bot.openBank()).toBe(true);
    expect(bank.npcAccess ? npc : object).toHaveBeenCalledWith(bank.npcAccess ?? bank.access, expect.any(Function));
    expect(bank.npcAccess ? object : npc).not.toHaveBeenCalled();
});
