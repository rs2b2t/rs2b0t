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
import { SettingsBag, SettingsStore } from '#/bot/runtime/Settings.js';
import MarketMaker, { MARKET_MAKER_SETTINGS } from '#/bot/scripts/MarketMaker/MarketMaker.js';

afterEach(() => {
    mock.restore();
    resetLiveCatalog();
    SettingsStore.clear('MarketMaker', 'blacklist');
});

async function fixture(settings: Record<string, unknown> = {}, stock: [number, number][] = []) {
    resetLiveCatalog();
    const records: ObjRecord[] = [
        { id: 995, name: 'Coins', cost: 1, stackable: true, members: false, equippable: false, certlink: -1, certtemplate: -1 },
        { id: 989, name: 'Crystal key', cost: 100, stackable: false, members: true, equippable: false, certlink: -1, certtemplate: -1 }
    ];
    for (const [id, name] of [[1163, 'Rune full helm'], [1127, 'Rune platebody'], [1079, 'Rune platelegs']] as const) {
        records.push({ id, name, cost: 100, stackable: false, members: false, equippable: true, certlink: -1, certtemplate: -1 });
        records.push({ id: id + 1, name, cost: 100, stackable: true, members: false, equippable: false, certlink: id, certtemplate: 799 });
    }
    const state = {
        pack: new Map([[995, 200_000]]),
        bank: new Map([[989, 24], [995, 200_000], ...stock]),
        bankOpen: false,
        noteMode: false
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
        rows: [989, 1163, 1127, 1079].map(id => ({ id, mid: 100, cap: 100, buying: true, selling: true }))
    });
    spyOn(Banking, 'open').mockImplementation(async () => {
        state.bankOpen = true;
        return true;
    });
    spyOn(Bank, 'close').mockImplementation(async () => {
        state.bankOpen = false;
        return true;
    });
    spyOn(Bank, 'setNoteMode').mockImplementation(async enabled => { state.noteMode = enabled; });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, qty) => {
        const held = state.bank.get(id) ?? 0;
        const target = state.noteMode ? records.find(item => item.certlink === id)?.id ?? id : id;
        const space = records.find(item => item.id === target)!.stackable ? qty : Inventory.free();
        const take = Math.min(qty, held, space);
        state.pack.set(target, (state.pack.get(target) ?? 0) + take);
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
    bot.settings = new SettingsBag(settings);
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(bot, 'sortBankNow').mockImplementation(async () => { bot['sortOwed'] = false; });
    await bot.onStart();
    await Bank.close();
    bot['sortOwed'] = false;
    const order = () => bot.counter().remember({ customer: 'Alice', itemId: 989, maxQty: 24, askedAtMs: Date.now() });
    const tick = () => TaskBot.prototype.loop.call(bot);
    return { bot, state, order, tick };
}

test('a chat order fetches and offers ten complete rune sets as notes', async () => {
    const { bot, state, tick } = await fixture({}, [[1163, 10], [1127, 10], [1079, 10]]);
    bot.handleCommand('Alice', 'Buying 10 rune sets');
    expect(bot.counter().intentFor('Alice', Date.now(), 90_000)?.maxQty).toBe(10);
    bot.requests().add('Alice');
    await tick();
    expect(state.pack.get(1164)).toBe(10);
    expect(state.pack.get(1128)).toBe(10);
    expect(state.pack.get(1080)).toBe(10);
    expect(bot.saleReady()).toBe(true);
    await tick();
    expect(bot.counter().current()?.customer).toBe('Alice');

    spyOn(Trade, 'active').mockReturnValue(true);
    const offered = new Map<number, number>();
    spyOn(Trade, 'myOffer').mockImplementation(() => [...offered].map(([id, count]) => ({ id, count, name: null })));
    spyOn(Trade, 'theirOffer').mockReturnValue([]);
    spyOn(Trade, 'removeAll').mockResolvedValue(true);
    spyOn(Trade, 'offer').mockImplementation(async (name, count, pick) => {
        const item = Inventory.items().find(item => item.name === name && (!pick || pick(item)));
        if (!item) return false;
        offered.set(item.id, count);
        state.pack.set(item.id, (state.pack.get(item.id) ?? 0) - count);
        return true;
    });
    const appraisal = bot.appraiseNow('Alice');
    expect([...appraisal.owe]).toEqual([[1163, 10], [1127, 10], [1079, 10]]);
    expect(appraisal.total).toBe(3030);
    expect(await bot.putUp(appraisal.owe)).toBe(true);
    expect([...offered]).toEqual([[1164, 10], [1128, 10], [1080, 10]]);
    spyOn(Trade, 'theirOffer').mockReturnValue([{ id: 989, name: 'Crystal key', count: 1 }]);
    expect(bot.appraiseNow('Alice').owe).toEqual(appraisal.owe);
});

test('a set quote is limited by the least stocked piece', async () => {
    const { bot } = await fixture({}, [[1163, 10], [1127, 4], [1079, 8]]);
    bot.handleCommand('Alice', 'buying 10 rune sets');
    expect(bot.counter().intentFor('Alice', Date.now(), 90_000)?.maxQty).toBe(4);
});

test('waits for each set component instead of treating earlier components as its offer', async () => {
    const { bot, tick } = await fixture({}, [[1163, 10], [1127, 10], [1079, 10]]);
    bot.handleCommand('Alice', 'buying 10 rune sets');
    await tick();
    const offered: { id: number; count: number; name: string }[] = [];
    const attempted: string[] = [];
    spyOn(Trade, 'myOffer').mockImplementation(() => offered);
    spyOn(Trade, 'removeAll').mockResolvedValue(true);
    spyOn(Trade, 'offer').mockImplementation(async (name, count) => {
        attempted.push(name);
        if (name === 'Rune full helm') offered.push({ id: 1164, count, name });
        return true;
    });
    expect(await bot.putUp(new Map([[1163, 10], [1127, 10], [1079, 10]]))).toBe(false);
    expect(attempted).toEqual(['Rune full helm', 'Rune platebody']);
});

test('a restock that runs short reduces every piece to complete sets', async () => {
    const { bot, state, tick } = await fixture({}, [[1163, 10], [1127, 10], [1079, 10]]);
    bot.handleCommand('Alice', 'buying 10 rune sets');
    state.bank.set(1127, 3);
    await tick();
    expect(bot.counter().intentFor('Alice', Date.now(), 90_000)?.maxQty).toBe(3);
    expect(bot.saleReady()).toBe(true);
    spyOn(Trade, 'theirOffer').mockReturnValue([]);
    expect([...bot.appraiseNow('Alice').owe]).toEqual([[1163, 3], [1127, 3], [1079, 3]]);
});

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

function failTrade(bot: MarketMaker, customer: string): void {
    bot.counter().open(customer, Date.now() - 100_000).sawOpen = true;
    bot.dropExpired();
}

test('blacklists the fifth opened failure and refuses later requests after cooldown', async () => {
    const { bot, tick } = await fixture({ blacklist: ['Eve'], cooldownSeconds: 0 });
    for (let i = 0; i < 4; i++) {
        failTrade(bot, i % 2 === 0 ? 'Alice' : ' alice ');
        expect(bot.blocked('Alice')).toBe(false);
    }
    failTrade(bot, 'ALICE');
    expect(bot.blocked('Alice')).toBe(true);
    expect(bot.blocked('Eve')).toBe(true);
    expect(SettingsStore.resolve('MarketMaker', MARKET_MAKER_SETTINGS).blacklist).toEqual(['eve', 'alice']);

    bot.requests().add('Alice');
    await tick();
    expect(bot.counter().current()).toBeNull();
    expect(bot.requests().has('Alice')).toBe(false);
});

test('a completed trade resets only that player\'s consecutive failures', async () => {
    const { bot } = await fixture();
    for (let i = 0; i < 4; i++) {
        failTrade(bot, 'Alice');
        failTrade(bot, 'Bob');
    }
    bot.completed({ give: new Map([[989, 1]]), get: new Map([[995, 100]]) }, ' ALICE ');
    failTrade(bot, 'Bob');
    expect(bot.blocked('Bob')).toBe(true);
    for (let i = 0; i < 4; i++) {
        failTrade(bot, 'Alice');
        expect(bot.blocked('Alice')).toBe(false);
    }
    failTrade(bot, 'Alice');
    expect(bot.blocked('Alice')).toBe(true);
});

test('requests that never opened do not count toward blacklisting', async () => {
    const { bot } = await fixture();
    for (let i = 0; i < 5; i++) {
        bot.counter().open('Alice', Date.now() - 100_000);
        bot.dropExpired();
    }
    for (let i = 0; i < 4; i++) failTrade(bot, 'Alice');
    expect(bot.blocked('Alice')).toBe(false);
    failTrade(bot, 'Alice');
    expect(bot.blocked('Alice')).toBe(true);
});

test('counts each closed trade once after the screen transition grace period', async () => {
    const { bot } = await fixture();
    let now = Date.now();
    spyOn(Date, 'now').mockImplementation(() => now);
    for (let i = 0; i < 5; i++) {
        bot.counter().open('Alice', now).sawOpen = true;
        bot.dropExpired();
        now += 2_999;
        bot.dropExpired();
        expect(bot.blocked('Alice')).toBe(false);
        now++;
        bot.dropExpired();
        bot.dropExpired();
        expect(bot.blocked('Alice')).toBe(i === 4);
    }
});

test('releasing an opened trade leaves the failure streak unchanged', async () => {
    const { bot } = await fixture();
    for (let i = 0; i < 4; i++) failTrade(bot, 'Alice');
    bot.counter().open('Alice', Date.now()).sawOpen = true;
    bot.release('Alice', 'the shop could not offer its items');
    expect(bot.blocked('Alice')).toBe(false);
    failTrade(bot, 'Alice');
    expect(bot.blocked('Alice')).toBe(true);
});

test.each(['cancelled', 'completed', 'late'])('reconciles a %s confirmation', async outcome => {
    const completed = outcome !== 'cancelled';
    const { bot, state, tick } = await fixture();
    for (let i = 0; i < 4; i++) failTrade(bot, 'Alice');
    const window = bot.counter().open('Alice', Date.now());
    window.accepted = { give: new Map([[989, 1]]), get: new Map([[995, 100]]) };
    let active = true;
    spyOn(Trade, 'active').mockImplementation(() => active);
    spyOn(Trade, 'partner').mockReturnValue('Alice');
    spyOn(Trade, 'onConfirmScreen').mockReturnValue(true);
    spyOn(reader, 'tradeConfirmReady').mockReturnValue(true);
    spyOn(reader, 'tradeConfirmOffers').mockReturnValue({
        mine: [{ id: 989, name: 'Crystal key', count: 1, slot: 0, ops: [], comId: 3542 }],
        theirs: [{ id: 995, name: 'Coins', count: 100, slot: 0, ops: [], comId: 3532 }]
    });
    spyOn(Trade, 'accept').mockImplementation(async () => {
        if (outcome === 'late') return true;
        active = false;
        if (completed) state.pack.set(995, 200_100);
        else state.pack.set(989, 1);
        return true;
    });
    await tick();
    if (outcome === 'late') {
        active = false;
        state.pack.set(995, 200_100);
        await tick();
    }
    expect(bot.counter().current()).toBeNull();
    expect(bot.blocked('Alice')).toBe(!completed);
    if (completed) {
        failTrade(bot, 'Alice');
        expect(bot.blocked('Alice')).toBe(false);
    }
});

test('a customer who leaves the confirmation screen open still times out', async () => {
    const { bot, tick } = await fixture();
    for (let i = 0; i < 4; i++) failTrade(bot, 'Alice');
    bot.counter().open('Alice', Date.now() - 100_000).sawOpen = true;
    let active = true;
    spyOn(Trade, 'active').mockImplementation(() => active);
    spyOn(Trade, 'partner').mockReturnValue('Alice');
    spyOn(Trade, 'onConfirmScreen').mockReturnValue(true);
    spyOn(reader, 'tradeConfirmReady').mockReturnValue(false);
    spyOn(Trade, 'decline').mockImplementation(async () => {
        active = false;
    });
    bot.counter().current()!.accepted = { give: new Map([[989, 1]]), get: new Map([[995, 100]]) };
    await tick();
    expect(active).toBe(false);
    expect(bot.counter().current()).toBeNull();
    expect(bot.blocked('Alice')).toBe(true);
});
