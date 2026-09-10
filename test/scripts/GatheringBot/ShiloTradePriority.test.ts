import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Game } from '#/bot/api/game/Game.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { HandleGatherMuleTrade } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';
import { shiloFixture } from './ShiloTripFixture.js';

afterEach(() => mock.restore());

async function priorityFixture() {
    const fixture = shiloFixture();
    const { bot, state } = fixture;
    state.pack.set('Raw trout', 1);
    bot.settings = new SettingsBag({
        fishMethod: 'Fly fishing — trout/salmon',
        baitQty: 10,
        location: 'Shilo Village',
        guildFeatherMinutes: 15,
        muleMode: 'Gatherer',
        mulePartner: 'Partner',
        purgePackOnStart: false,
        packJunk: 'Off'
    });
    spyOn(Game, 'tile').mockReturnValue(new Tile(2841, 2970, 0));
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    const tradeActive = spyOn(Trade, 'active').mockReturnValue(true);
    const tradeExecute = spyOn(HandleGatherMuleTrade.prototype, 'execute').mockResolvedValue(undefined);
    const clock = { now: 10000 };
    spyOn(Date, 'now').mockImplementation(() => clock.now);
    await bot.onStart();
    expect(bot.isMuleGatherer()).toBe(true);
    expect(bot.guildFeatherTripDue()).toBe(true);
    expect(state.events).toEqual([]);
    return { ...fixture, tradeActive, tradeExecute, clock };
}

test('selects the registered trade handler before a due outbound supply trip while trade is open', async () => {
    const { bot, state, tradeExecute } = await priorityFixture();

    await bot.loop();

    expect(tradeExecute).toHaveBeenCalledTimes(1);
    expect(bot.shiloSupplyTrip.active).toBe(false);
    expect(state.events).toEqual([]);
    expect(state.shoppingPacks).toEqual([]);
});

test('keeps trade priority through a missing-modal grace gap and runs supplies after release', async () => {
    const { bot, state, tradeActive, tradeExecute, clock } = await priorityFixture();
    bot['guildFeatherMinutes'] = 0;
    await bot.loop();
    expect(tradeExecute).toHaveBeenCalledTimes(1);
    bot['guildFeatherMinutes'] = 15;
    tradeActive.mockReturnValue(false);
    clock.now += 1000;
    tradeExecute.mockClear();

    await bot.loop();

    expect(tradeExecute).toHaveBeenCalledTimes(1);
    expect(bot.shiloSupplyTrip.active).toBe(false);
    expect(state.events).toEqual([]);
    expect(state.shoppingPacks).toEqual([]);

    clock.now += 1001;
    tradeExecute.mockClear();
    await bot.loop();
    expect(tradeExecute).not.toHaveBeenCalled();
    expect(bot.shiloSupplyTrip.phase).toBe('feathers');
    expect(state.events).toEqual(['bank', 'deposit']);
});
