import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import SmithingBot from '#/bot/scripts/SmithingBot/SmithingBot.js';

afterEach(() => mock.restore());

const hammer = { id: 2347, name: 'Hammer', count: 1, comId: 0, slot: 0, ops: [] };
const warhammer = { ...hammer, id: 1339, name: 'Steel warhammer' };
const bar = { ...hammer, id: 2353, name: 'Steel bar' };

async function bankTrip(product: string, banked: number, carried = 0, { ready = true, items = [hammer] } = {}) {
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
    let pack = [...items, ...Array<typeof bar>(carried).fill(bar)];
    const deposited: typeof pack = [];
    spyOn(reader, 'inventory').mockImplementation(() => pack.map((item, slot) => ({ ...item, slot })));
    spyOn(reader, 'bankItems').mockImplementation(() => banked ? [...deposited, { ...bar, count: banked }] : deposited);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        pack = pack.filter(item => {
            if (!match(item.name, item.id)) return true;
            if (item.id === bar.id) banked++;
            else deposited.push(item);
            return false;
        });
    });
    const withdraw = spyOn(Bank, 'withdrawLoad').mockImplementation(async name => {
        if (name !== bar.name) return false;
        const amount = Math.min(banked, 28 - pack.length);
        pack.push(...Array<typeof bar>(amount).fill(bar));
        banked -= amount;
        return true;
    });
    await bot.onStart();
    await bot.loop();
    return { finish, withdraw, banked, pack, deposited };
}

test.each([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [0, 1], [0, 4], [2, 1]])('a platebody run ends with %i banked and %i carried', async (stock, carried) => {
    const { finish, withdraw, banked } = await bankTrip('Platebody', stock, carried);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(finish.mock.calls[0]?.[0]).toContain('Platebody');
    expect(withdraw).not.toHaveBeenCalled();
    expect(banked).toBe(stock + carried);
});

test.each([['Platebody', 5, 0], ['Platebody', 4, 1], ['Scimitar', 2, 0], ['Dagger', 1, 0], ['Chainbody', 2, 1]] satisfies [string, number, number][])(
    '%s continues with %i banked and %i carried', async (product, banked, carried) => {
        const { finish, withdraw, pack } = await bankTrip(product, banked, carried);
        expect(finish).not.toHaveBeenCalled();
        expect(withdraw).toHaveBeenCalledWith('Steel bar');
        expect(pack.filter(item => item.id === bar.id)).toHaveLength(banked + carried);
    }
);

test('an unread bank does not end the run', async () => {
    const { finish, withdraw } = await bankTrip('Platebody', 0, 1, { ready: false });
    expect(finish).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
});

test('a chainbody run deposits its last two bars and finishes', async () => {
    const { finish, withdraw, banked, pack } = await bankTrip('Chainbody', 1, 1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(withdraw).not.toHaveBeenCalled();
    expect(banked).toBe(2);
    expect(pack).toEqual([hammer]);
});

test('a warhammer run deposits all 25 products and loads 27 bars alongside the hammer', async () => {
    const products = Array<typeof warhammer>(25).fill(warhammer);
    const { pack, deposited } = await bankTrip('Warhammer', 50, 2, { items: [hammer, ...products] });
    expect(deposited.filter(item => item.id === warhammer.id)).toHaveLength(25);
    expect(pack).toContain(hammer);
    expect(pack.filter(item => item.id === bar.id)).toHaveLength(27);
});

test('a banked warhammer cannot supply the missing tool', async () => {
    const { withdraw, deposited } = await bankTrip('Warhammer', 3, 0, { items: [warhammer] });
    expect(deposited).toEqual([warhammer]);
    expect(withdraw).not.toHaveBeenCalled();
});

test('the tool lookup skips a warhammer in an earlier slot', () => {
    spyOn(reader, 'inventory').mockReturnValue([warhammer, { ...hammer, slot: 1 }]);
    expect(new SmithingBot().hammerItem()?.id).toBe(hammer.id);
});
