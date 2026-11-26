import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import MuleDepot from '#/bot/scripts/MuleDepot/MuleDepot.js';
import { TRADE_GRACE_MS } from '#/bot/scripts/MuleDepot/MuleDepotContext.js';

let bot: MuleDepot;
afterEach(() => {
    bot.disposeSubscriptions();
    mock.restore();
});

async function supplier(loadout: string[], stock = 0) {
    bot = new MuleDepot();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ mode: 'Supply', designation: 'Supplier', accounts: 'first,second', tradeSlots: 1, loadout });
    const pack: InvItemSnapshot[] = [];
    const coins = { id: 995, name: 'Coins', count: stock, slot: 0, comId: 0, ops: [] };
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'objCatalog').mockReturnValue([]);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(bot.bankTile());
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    const offerScreen = spyOn(reader, 'tradeOfferOpen').mockReturnValue(false);
    const confirmScreen = spyOn(reader, 'tradeConfirmOpen').mockReturnValue(false);
    spyOn(bot, 'nearestPartner').mockReturnValue(null);
    spyOn(Bank, 'openBooth').mockResolvedValue(true);
    const reads = spyOn(Bank, 'waitReady').mockResolvedValue(true);
    spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
    spyOn(Bank, 'close').mockResolvedValue(true);
    spyOn(Bank, 'items').mockImplementation(() => coins.count > 0 ? [coins] : []);
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, quantity) => {
        if (id !== coins.id || quantity > coins.count) return false;
        pack.push({ ...coins, count: quantity });
        coins.count -= quantity;
        return true;
    });
    const stop = spyOn(ScriptRunner, 'stop').mockImplementation(() => {});
    await bot.onStart();
    return { pack, reads, stop, offerScreen, confirmScreen };
}

test('an empty bank reports both clients short after the initial retries', async () => {
    const { reads, stop } = await supplier(['Air rune']);
    for (let pass = 0; pass < 10 && bot.currentClient(); pass++) await bot.loop();
    expect(reads).toHaveBeenCalledTimes(3);
    expect(bot.currentClient()).toBeNull();
    expect(stop.mock.calls[0]?.[0]).toEndWith('0 item(s) moved — short: first: 1 Air rune; second: 1 Air rune');
});

test('each client gets the stocked batch after its unavailable batch', async () => {
    const { pack, reads, stop, offerScreen, confirmScreen } = await supplier(['Air rune', '2 Coins'], 4);
    let now = Date.now();
    spyOn(Date, 'now').mockImplementation(() => now);
    const offer: InvItemSnapshot[] = [];
    spyOn(reader, 'tradeMyOffer').mockImplementation(() => offer);
    const partner = spyOn(reader, 'tradePartner');
    spyOn(Trade, 'offer').mockImplementation(async (name, quantity) => {
        expect(pack[0]).toMatchObject({ name, count: quantity });
        offer.push(...pack.splice(0));
        return true;
    });
    spyOn(Trade, 'accept').mockImplementation(async () => {
        confirmScreen.mockReturnValue(Trade.onOfferScreen());
        offerScreen.mockReturnValue(false);
        return true;
    });
    for (const client of ['first', 'second']) {
        for (let pass = 0; pass < 10 && pack.length === 0; pass++) await bot.loop();
        expect(bot.currentClient()).toBe(client);
        expect(pack[0]).toMatchObject({ name: 'Coins', count: 2 });
        partner.mockReturnValue(client);
        offerScreen.mockReturnValue(true);
        await bot.loop();
        expect(offer[0]).toMatchObject({ name: 'Coins', count: 2 });
        await bot.loop();
        await bot.loop();
        offer.length = 0;
        now += TRADE_GRACE_MS;
    }
    expect(reads).toHaveBeenCalledTimes(5);
    expect(bot.currentClient()).toBeNull();
    expect(stop.mock.calls[0]?.[0]).toEndWith('4 item(s) moved — short: first: 1 Air rune; second: 1 Air rune');
});
