import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { Trade } from '#/bot/api/trade/Trade.js';
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

test.each(['paid', 'price changed', 'goods changed', 'wrong bidder', 'wrong confirmer', 'short payment', 'no confirmation', 'no bid', 'short of confirmed price'])('a maker-accepted bid goes directly to verified confirmation: %s', async outcome => {
    const bank = BANK_LOCATIONS.find(b => b.name === 'Duel Arena')!;
    const ring: InvItemSnapshot = { id: 1637, name: 'Sapphire ring', count: 1, slot: 0, comId: 3322, ops: [] };
    const coins = { ...ring, id: 995, name: 'Coins', count: 100 };
    let screen: 'offer' | 'confirm' | 'closed' = 'offer';
    let staked = false;
    let paid = 0;
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(bank.tile);
    spyOn(reader, 'objCatalog').mockReturnValue([{ ...ring, name: 'Sapphire ring', cost: 900, stackable: false, members: false, equippable: true, certlink: -1, certtemplate: -1 }]);
    spyOn(Inventory, 'used').mockReturnValue(0);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? paid : 0);
    spyOn(reader, 'tradePartner').mockImplementation(() => (screen === 'offer' && outcome === 'wrong bidder') || (screen === 'confirm' && outcome === 'wrong confirmer') ? 'other maker' : 'test maker');
    spyOn(reader, 'tradeOfferOpen').mockImplementation(() => screen === 'offer');
    spyOn(reader, 'tradeConfirmOpen').mockImplementation(() => screen === 'confirm');
    spyOn(reader, 'tradeSidePack').mockImplementation(() => staked ? [] : [ring]);
    spyOn(reader, 'tradeMyOffer').mockImplementation(() => staked ? [ring] : []);
    spyOn(reader, 'tradeTheirOffer').mockReturnValue(outcome === 'no bid' ? [] : [coins]);
    let elapsed = 0;
    if (outcome === 'no bid') spyOn(Date, 'now').mockImplementation(() => elapsed);
    spyOn(reader, 'ifText').mockImplementation(id => id === 3431 ? 'Other player has accepted.' : null);
    spyOn(reader, 'tradeConfirmReady').mockReturnValue(true);
    spyOn(reader, 'tradeConfirmOffers').mockImplementation(() => ({
        mine: outcome === 'goods changed' ? [] : [ring],
        theirs: [{ ...coins, count: outcome === 'price changed' ? 50 : outcome === 'short of confirmed price' ? 200 : 100 }]
    }));
    spyOn(Trade, 'offerAll').mockImplementation(async () => { staked = true; return true; });
    const accept = spyOn(Trade, 'accept').mockImplementation(async () => {
        if (screen === 'offer' && outcome !== 'no confirmation') screen = 'confirm';
        else { screen = 'closed'; paid = outcome === 'short payment' ? 50 : 100; }
        return true;
    });
    const decline = spyOn(Trade, 'decline').mockImplementation(async () => { screen = 'closed'; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async check => check());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const waits = spyOn(Execution, 'delayUntil').mockImplementation(async (check, timeout) => {
        elapsed += timeout ?? 0;
        return Boolean(await check());
    });
    const bot = new JiveMarketDumper();
    bot.settings = new SettingsBag({ maker: 'test maker', bank: bank.name });
    bot.bindLog(() => {});
    await bot.onStart();
    waits.mockClear();
    await bot['tasks'].find(task => task.constructor.name === 'Sell')!.execute();
    expect(accept).toHaveBeenCalledTimes(['wrong bidder', 'no bid'].includes(outcome) ? 0 : ['paid', 'short payment', 'short of confirmed price'].includes(outcome) ? 2 : 1);
    expect(decline).toHaveBeenCalledTimes(['paid', 'short payment', 'short of confirmed price', 'no confirmation'].includes(outcome) ? 0 : 1);
    expect(staked).toBe(outcome !== 'wrong bidder');
    expect(bot.refused.has(ring.id)).toBe(outcome === 'no bid');
    expect(bot.gp).toBe(outcome === 'paid' ? 100 : 0);
    expect(waits.mock.calls.some(([, timeout]) => timeout === 500)).toBe(outcome === 'no bid');
});
