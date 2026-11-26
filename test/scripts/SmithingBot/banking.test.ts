import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import SmithingBot from '#/bot/scripts/SmithingBot/SmithingBot.js';

afterEach(() => mock.restore());

async function bankTrip(product: string, banked: number, carried = 0, ready = true) {
    const bot = new SmithingBot();
    const finish = mock((_reason: string) => {});
    bot.bindFinish(finish);
    bot.settings = new SettingsBag({ bar: 'Steel', product });
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(bot.bankTile());
    spyOn(ChatDialog, 'isMainMakePanel').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async check => check());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Bank, 'openBooth').mockResolvedValue(true);
    spyOn(Bank, 'ready').mockReturnValue(ready);
    spyOn(Bank, 'backpackReady').mockResolvedValue(true);
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    spyOn(bot, 'barCount').mockImplementation(() => carried);
    const hammer = { id: 2347, name: 'Hammer', count: 1, comId: 0, slot: 0, ops: [] };
    spyOn(reader, 'inventory').mockReturnValue([hammer]);
    spyOn(reader, 'bankItems').mockImplementation(() => banked ? [{ ...hammer, id: 2353, name: 'Steel bar', count: banked }] : []);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        if (match('Steel bar', 2353)) {
            banked += carried;
            carried = 0;
        }
    });
    const withdraw = spyOn(Bank, 'withdrawLoad').mockResolvedValue(true);
    await bot.onStart();
    await bot.loop();
    return { finish, withdraw, banked };
}

test.each([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [0, 4], [2, 1]])('a platebody run ends with %i banked and %i carried', async (stock, carried) => {
    const { finish, withdraw, banked } = await bankTrip('Platebody', stock, carried);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[0]).toContain('Platebody');
    expect(withdraw).not.toHaveBeenCalled();
    expect(banked).toBe(stock + carried);
});

test.each([['Platebody', 5, 0], ['Platebody', 4, 1], ['Scimitar', 2, 0], ['Dagger', 1, 0]] satisfies [string, number, number][])(
    '%s continues with %i banked and %i carried', async (product, banked, carried) => {
        const { finish, withdraw } = await bankTrip(product, banked, carried);
        expect(finish).not.toHaveBeenCalled();
        expect(withdraw).toHaveBeenCalledWith('Steel bar');
    }
);

test('an unread bank does not end the run', async () => {
    const { finish, withdraw } = await bankTrip('Platebody', 0, 1, false);
    expect(finish).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
});
