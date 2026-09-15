import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { TaskBot } from '#/bot/api/bot/Bot.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { PriceBooks } from '#/bot/api/market/bookStore.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import Tile from '#/bot/geometry/Tile.js';
import MarketMaker from '#/bot/scripts/MarketMaker/MarketMaker.js';

afterEach(() => {
    mock.restore();
    resetLiveCatalog();
});

async function fixture() {
    resetLiveCatalog();
    const records: ObjRecord[] = [
        { id: 995, name: 'Coins', cost: 1, stackable: true, members: false, equippable: false, certlink: -1, certtemplate: -1 },
        { id: 989, name: 'Crystal key', cost: 100, stackable: false, members: true, equippable: false, certlink: -1, certtemplate: -1 }
    ];
    const state = {
        pack: new Map([[995, 200_000]]),
        bank: new Map([[989, 24], [995, 200_000]]),
        bankOpen: false
    };
    const snapshots = (items: Map<number, number>, bank = false): InvItemSnapshot[] => {
        const out: InvItemSnapshot[] = [];
        for (const [id, count] of items) {
            const record = records.find(item => item.id === id)!;
            const stacked = bank || record.stackable;
            for (let i = 0; i < (stacked ? Number(count > 0) : count); i++) {
                out.push({ id, name: record.name, count: stacked ? count : 1, slot: out.length, ops: [], comId: bank ? 5382 : 3214 });
            }
        }
        return out;
    };
    spyOn(reader, 'objCatalog').mockReturnValue(records);
    spyOn(reader, 'inventory').mockImplementation(() => snapshots(state.pack));
    spyOn(reader, 'bankSideItems').mockImplementation(() => snapshots(state.pack));
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankItems').mockImplementation(() => state.bankOpen ? snapshots(state.bank, true) : []);
    spyOn(reader, 'bankSnapshotReady').mockImplementation(() => state.bankOpen);
    spyOn(reader, 'bankComId').mockImplementation(() => state.bankOpen ? 5382 : -1);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: state.bankOpen ? 5292 : -1, side: state.bankOpen ? 5063 : -1, chat: -1 }));
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2725, 3491, 0));
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Trade, 'active').mockReturnValue(false);
    spyOn(Trade, 'request').mockResolvedValue(true);
    spyOn(PriceBooks, 'byName').mockReturnValue({
        name: 'Keys', margin: 0, maxTradeValue: 1_000_000,
        rows: [{ id: 989, mid: 100, cap: 100, buying: true, selling: true }]
    });
    spyOn(Banking, 'open').mockImplementation(async () => {
        state.bankOpen = true;
        return true;
    });
    spyOn(Bank, 'close').mockImplementation(async () => {
        state.bankOpen = false;
        return true;
    });
    spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, qty) => {
        const held = state.bank.get(id) ?? 0;
        const space = id === 995 ? qty : Inventory.free();
        const take = Math.min(qty, held, space);
        state.pack.set(id, (state.pack.get(id) ?? 0) + take);
        state.bank.set(id, held - take);
        return take === qty;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        for (const [id, count] of state.pack) {
            if (!predicate(records.find(item => item.id === id)!.name, id)) continue;
            state.bank.set(id, (state.bank.get(id) ?? 0) + count);
            state.pack.delete(id);
        }
    });
    const bot = new MarketMaker();
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(bot, 'sortBankNow').mockImplementation(async () => { bot['sortOwed'] = false; });
    await bot.onStart();
    await Bank.close();
    bot['sortOwed'] = false;
    const order = () => bot.counter().remember({ customer: 'Alice', itemId: 989, maxQty: 24, askedAtMs: Date.now() });
    const tick = () => TaskBot.prototype.loop.call(bot);
    return { bot, state, order, tick };
}

test('fetches 24 nonnoteable keys and opens the prepared sale instead of banking them again', async () => {
    const { bot, state, order, tick } = await fixture();
    order();
    bot.requests().add('Alice');

    await tick();
    expect(Inventory.free()).toBe(3);
    expect(state.pack.get(989)).toBe(24);
    expect(state.pack.get(995)).toBe(200_000);
    await tick();

    expect(bot.counter().current()?.customer).toBe('Alice');
    expect(state.pack.get(989)).toBe(24);
    expect(state.bank.get(989)).toBe(0);
});

test('keeps a prepared sale in the pack until its buyer requests a trade', async () => {
    const { bot, state, order, tick } = await fixture();
    order();

    await tick();
    await tick();
    expect(state.pack.get(989)).toBe(24);
    expect(state.bank.get(989)).toBe(0);

    bot.requests().add('Alice');
    await tick();
    expect(bot.counter().current()?.customer).toBe('Alice');
});

test.each(['cash', 'reset'] as const)('settles %s before serving a prepared sale, then fetches and opens it', async reason => {
    const { bot, state, order, tick } = await fixture();
    order();
    await tick();
    if (reason === 'cash') {
        state.pack.set(995, 250_000);
    } else {
        await bot['resetState']();
        order();
    }
    bot.requests().add('Alice');

    await tick();
    expect(bot.counter().current()).toBeNull();
    expect(state.pack.get(989) ?? 0).toBe(0);
    expect(state.bank.get(989)).toBe(24);
    expect(state.pack.get(995)).toBe(200_000);
    expect(bot.settleForced()).toBe(false);

    await tick();
    await tick();
    expect(bot.counter().current()?.customer).toBe('Alice');
});

test('banks a crowded pack before opening an incoming purchase', async () => {
    const { bot, state, tick } = await fixture();
    state.pack.set(989, 24);
    state.bank.set(989, 0);
    bot.requests().add('Bob');

    await tick();
    expect(bot.counter().current()).toBeNull();
    expect(state.pack.get(989) ?? 0).toBe(0);
    expect(state.bank.get(989)).toBe(24);
    await tick();
    expect(bot.counter().current()?.customer).toBe('Bob');
});
