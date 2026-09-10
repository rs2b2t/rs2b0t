import { spyOn } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { unitPrice } from '#/bot/api/shop/StockModel.js';
import { SHOP_DB } from '#/bot/data/shopdb.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { FISHING_LOCATIONS } from '#/bot/data/fishingLocations.js';
import { FISHING_METHODS } from '#/bot/data/fishingMethods.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { BuyShiloSupplies } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

export function shiloFixture(camp = 'Shilo Village') {
    const bot = new GatheringBot();
    bot['fishing'] = true;
    bot['guildFeatherMinutes'] = 15;
    bot['location'] = FISHING_LOCATIONS.find(location => location.name === camp) ?? null;
    bot['fishMethod'] = FISHING_METHODS.find(method => method.op === 'Lure') ?? null;
    bot['gearKeep'] = ['Fly fishing rod', 'Feather', 'Hammer', 'Small fishing net'];
    const state = {
        pack: new Map([['Coins', 10000], ['Fly fishing rod', 1], ['Feather', 10], ['Raw trout', 24], ['Hammer', 1]]),
        bankCoins: 10000,
        drawn: 0,
        deposited: new Map<string, number>(),
        bankOpen: false,
        openOk: true,
        ready: true,
        depositOk: true,
        loseSnapshotOnDeposit: false,
        sideReady: true,
        closeOk: true,
        featherStock: 800,
        vialStock: 50,
        vialListed: true,
        keeper: '',
        events: new Array<string>(),
        purchases: new Array<{ name: string; qty: number }>(),
        shoppingPacks: new Array<string[]>()
    };
    const snapshots = (): InvItemSnapshot[] => [...state.pack].flatMap(([name, count], id) =>
        Array.from({ length: name === 'Coins' || name === 'Feather' ? 1 : count }, (_, slot) => ({
            name, count: name === 'Coins' || name === 'Feather' ? count : 1, id, slot, ops: [], comId: 3214
        })));
    spyOn(reader, 'inventory').mockImplementation(snapshots);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.sideReady ? snapshots() : []);
    spyOn(reader, 'bankSideSnapshotReady').mockImplementation(() => state.sideReady);
    spyOn(reader, 'modals').mockReturnValue({ main: 1, side: 1, chat: -1 });
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventorySnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankComId').mockImplementation(() => state.bankOpen ? 1 : -1);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'animating').mockReturnValue(true);
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(bot, 'openScriptBank').mockImplementation(async () => {
        state.events.push('bank');
        state.bankOpen = state.openOk;
        return state.openOk;
    });
    spyOn(bot, 'closeScriptBank').mockImplementation(async () => {
        if (state.closeOk) state.bankOpen = false;
        return state.closeOk;
    });
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.ready);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'count').mockImplementation(() => state.bankCoins);
    spyOn(Bank, 'withdrawX').mockImplementation(async (_name, qty) => {
        state.drawn += qty;
        state.pack.set('Coins', (state.pack.get('Coins') ?? 0) + qty);
        state.bankCoins -= qty;
        return true;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        state.events.push('deposit');
        if (state.loseSnapshotOnDeposit) { state.sideReady = false; return; }
        if (state.depositOk) for (const [name, count] of state.pack) if (match(name, 0)) {
            state.deposited.set(name, (state.deposited.get(name) ?? 0) + count);
            state.pack.delete(name);
        }
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(bot, 'walkHomeIfNeeded').mockImplementation(async () => {
        state.events.push('home');
        return true;
    });
    spyOn(Shop, 'open').mockImplementation(async keeper => {
        state.keeper = keeper;
        state.events.push(keeper);
        state.shoppingPacks.push([...state.pack.keys()]);
        return true;
    });
    spyOn(Shop, 'stock').mockImplementation(() => state.keeper === 'Obli'
        ? state.vialListed ? [{ name: 'Vial of water', count: state.vialStock, slot: 0 }] : []
        : [{ name: 'Feather', count: state.featherStock, slot: 0 }]);
    spyOn(Shop, 'buy').mockImplementation(async (name, qty) => {
        const shop = state.keeper === 'Obli' ? SHOP_DB.shilojunglestore : SHOP_DB.shilofishingshop;
        const item = shop?.items.find(line => line.name === name);
        if (!shop || !item) throw new Error('Unknown fixture shop item');
        const stock = name === 'Feather' ? state.featherStock : state.vialStock;
        let cost = 0;
        for (let unit = 0; unit < qty; unit++) cost += unitPrice(item, shop, stock - unit);
        if (cost > (state.pack.get('Coins') ?? 0)) throw new Error('Unaffordable fixture purchase');
        state.pack.set('Coins', (state.pack.get('Coins') ?? 0) - cost);
        state.purchases.push({ name, qty });
        state.pack.set(name, (state.pack.get(name) ?? 0) + qty);
        return qty;
    });
    spyOn(Shop, 'close').mockResolvedValue(undefined);
    const task = new BuyShiloSupplies(bot);
    return { bot, state, task, async run() {
        for (let leg = 0; leg < 8 && task.validate(); leg++) await task.execute();
    } };
}
