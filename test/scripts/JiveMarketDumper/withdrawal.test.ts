import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { MarketSeller } from '#/bot/scripts/AccountLeveler/marketSeller.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import { Game } from '#/bot/api/game/Game.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveMarketDumper from '#/bot/scripts/JiveMarketDumper/JiveMarketDumper.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import { planPile, type Dumpable } from '#/bot/scripts/JiveMarketDumper/logic.js';
import { withdrawPile } from '#/bot/scripts/JiveMarketDumper/withdrawal.js';

afterEach(() => { mock.restore(); resetLiveCatalog(); });

function line(id: number, count: number, notedId: number | null = null, stackable = false): Dumpable {
    return { id, count, notedId, stackable, name: 'Item ' + id, displayName: 'Item ' + id };
}

function bank(stock: Dumpable[]) {
    const ops = ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X'];
    const rows = stock.map((line, slot) => ({ id: line.id, count: line.count, name: line.name, ops, slot, comId: 5382 }));
    const pack: InvItemSnapshot[] = [];
    const state = { open: true, dropOnce: -1, ignore: false, dialog: -1, closeOnUpdate: false, wrongForm: false };
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: 5292, side: 5063, chat: -1 }));
    spyOn(reader, 'bankSnapshotReady').mockImplementation(() => state.open);
    spyOn(reader, 'bankSideSnapshotReady').mockImplementation(() => state.open);
    spyOn(reader, 'bankItems').mockImplementation(() => rows.filter(row => row.count > 0));
    spyOn(reader, 'bankSideItems').mockImplementation(() => pack);
    spyOn(reader, 'countDialogOpen').mockImplementation(() => state.dialog !== -1);
    const batches: number[][] = [];
    const exact: number[] = [];
    let clicks: number[] = [];
    const land = (id: number, count: number) => {
        const row = rows.find(row => row.id === id)!;
        row.count -= count;
        const item = stock.find(item => item.id === id)!;
        pack.push({ ...row, id: state.wrongForm ? id : item.notedId ?? id, count, slot: pack.length });
    };
    spyOn(Input, 'invButton').mockImplementation((id, _slot, _com, op) => {
        if (op === 5) state.dialog = id;
        else { expect(op).toBe(4); clicks.push(id); }
        return true;
    });
    spyOn(actions, 'answerCountDialog').mockImplementation(count => {
        expect(clicks).toHaveLength(0);
        exact.push(count);
        land(state.dialog, count);
        state.dialog = -1;
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async check => check());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async check => {
        if (clicks.length) batches.push(clicks);
        for (const id of clicks) {
            if (state.ignore) continue;
            if (id === state.dropOnce) { state.dropOnce = -1; continue; }
            land(id, rows.find(row => row.id === id)!.count);
        }
        clicks = [];
        if (state.closeOnUpdate) state.open = false;
        return check();
    });
    return { batches, exact, pack, state, rows };
}

test('twenty noted and stackable bank rows take four batches with no quantity dialogs', async () => {
    const stock = Array.from({ length: 20 }, (_, i) => line(100 + i, 500, i % 2 ? 200 + i : null, i % 2 === 0));
    const { batches, exact, pack } = bank(stock);
    expect(await withdrawPile(planPile(stock))).toBe(true);
    expect(batches.map(batch => batch.length)).toEqual([5, 5, 5, 5]);
    expect(exact).toEqual([]);
    expect(pack.map(row => row.id)).toEqual(stock.map(item => item.notedId ?? item.id));
});

test('the capped non-stackable row uses one exact withdrawal after the batch lands', async () => {
    const stock = [line(100, 800, 200), line(101, 50)];
    const { batches, exact, rows } = bank(stock);
    expect(await withdrawPile(planPile(stock))).toBe(true);
    expect(batches).toEqual([[100]]);
    expect(exact).toEqual([19]);
    expect(rows[1].count).toBe(31);
});

test('a dropped click retries only the missing bank row', async () => {
    const stock = [line(100, 1), line(101, 2), line(102, 1)];
    const { state, batches } = bank(stock);
    state.dropOnce = 101;
    expect(await withdrawPile(stock)).toBe(true);
    expect(batches).toEqual([[100, 101, 102], [101]]);
});

test.each(['closed', 'no progress', 'wrong form'])('an unconfirmed batch cannot succeed: %s', async reason => {
    const stock = [line(100, 100, 200)];
    const { state, batches } = bank(stock);
    state.closeOnUpdate = reason === 'closed';
    state.ignore = reason === 'no progress';
    state.wrongForm = reason === 'wrong form';
    expect(await withdrawPile(stock)).toBe(false);
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.length).toBeLessThanOrEqual(3);
});

test('restock recovers an incomplete load before the dumper approaches the maker', async () => {
    const stock = [line(1637, 10, 1638)];
    const { state, pack, rows } = bank(stock);
    const site = BANK_LOCATIONS.find(b => b.name === 'Duel Arena')!;
    const ring = { id: 1637, name: 'Sapphire ring', cost: 900, stackable: false, members: false, equippable: true, certlink: -1, certtemplate: -1 };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(site.tile);
    spyOn(reader, 'objCatalog').mockReturnValue([ring, { ...ring, id: 1638, stackable: true, certlink: 1637, certtemplate: 799 }]);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async () => {
        rows[0].count += pack.reduce((n, item) => n + item.count, 0);
        pack.length = 0;
    });
    const bot = new JiveMarketDumper();
    bot.settings = new SettingsBag({ maker: 'test maker', bank: site.name });
    bot.bindLog(() => {});
    await bot.onStart();
    const tasks = bot['tasks'];
    const next = () => tasks.find(task => ['Restock', 'Approach'].includes(task.constructor.name) && task.validate())!;
    state.wrongForm = true;
    await next().execute();
    expect(next().constructor.name).toBe('Restock');
    expect(Bank.close).not.toHaveBeenCalled();
    state.wrongForm = false;
    await next().execute();
    expect(pack.map(row => [row.id, row.count])).toEqual([[1638, 10]]);
    expect(state.open).toBe(false);
    expect(next().constructor.name).toBe('Approach');
    expect(Bank.setNoteMode).toHaveBeenCalledWith(true);
});

test.each(['sold out', 'maker absent'])('the leveler keeps protected stock and finishes only its child: %s', async outcome => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { host: 'localhost', search: '?world=1' } });
    try {
        const stock = [line(453, 2450, 454), line(556, 10999, null, true), line(1359, 1), line(995, 5000, null, true)];
        const { state, rows, pack, exact, batches } = bank(stock);
        const site = BANK_LOCATIONS.find(b => b.name === 'Seers')!;
        const catalog = (id: number, name: string, stackable = false, certlink = -1) =>
            ({ id, name, cost: 100, stackable, members: false, equippable: id === 1359, certlink, certtemplate: certlink === -1 ? -1 : 799 });
        spyOn(Game, 'ingame').mockReturnValue(true);
        spyOn(Game, 'tile').mockReturnValue(site.tile);
        spyOn(reader, 'objCatalog').mockReturnValue([catalog(453, 'Coal'), catalog(454, 'Coal', true, 453), catalog(556, 'Air rune', true), catalog(1359, 'Rune axe'), catalog(995, 'Coins', true)]);
        spyOn(reader, 'inventory').mockImplementation(() => pack);
        spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
        spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
        const bot = new MarketSeller();
        const finish = mock(() => {});
        bot.settings = new SettingsBag({ maker: 'someone else', bank: 'Duel Arena' });
        bot.bindFinish(finish);
        bot.bindLog(() => {});
        await bot.onStart();
        expect(bot.maker).toBe('seers market');
        expect(bot.recoveryAnchor()).toEqual(site.tile);
        const restock = bot['tasks'].find(task => task.constructor.name === 'Restock')!;
        await restock.execute();
        expect(exact).toEqual([2000]);
        expect(batches).toEqual([]);
        expect(rows.map(row => row.count)).toEqual([450, 10999, 1, 5000]);
        pack.push({ ...rows[2], slot: 1 }, { ...rows[3], slot: 2 });
        expect(bot.packPile().map(row => [row.id, row.count])).toEqual([[453, 2000]]);
        expect(bot.dumpable([{ id: 454, count: 1500 }, { id: 556, count: 999 }])).toEqual([]);
        if (outcome === 'maker absent') {
            spyOn(reader, 'players').mockReturnValue([]);
            spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
            spyOn(bot, 'openBank').mockImplementation(async () => { state.open = true; return true; });
            spyOn(Bank, 'depositAllMatching').mockImplementation(async () => {
                for (const item of pack) rows.find(row => row.id === (item.id === 454 ? 453 : item.id))!.count += item.count;
                pack.length = 0;
            });
            const approach = bot['tasks'].find(task => task.constructor.name === 'Approach')!;
            for (let retry = 0; retry < 20 && !finish.mock.calls.length; retry++) await approach.execute();
            expect(rows[0].count).toBe(2450);
            expect(pack).toHaveLength(0);
        } else {
            pack.length = 0;
            state.open = true;
            await restock.execute();
        }
        expect(finish).toHaveBeenCalledTimes(1);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'location', previous);
        else Reflect.deleteProperty(globalThis, 'location');
    }
});

test('the leveler seller finishes before touching the bank on World 2', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { host: 'localhost', search: '?world=2' } });
    try {
        const bot = new MarketSeller();
        const finish = mock(() => {});
        bot.bindFinish(finish);
        await bot.onStart();
        expect(finish).toHaveBeenCalledTimes(1);
        expect(bot['tasks']).toHaveLength(0);
    } finally {
        if (previous) Object.defineProperty(globalThis, 'location', previous);
        else Reflect.deleteProperty(globalThis, 'location');
    }
});

test('interrupting the child closes a pending trade', () => {
    spyOn(reader, 'tradeOfferOpen').mockReturnValue(true);
    const close = spyOn(actions, 'closeModal').mockReturnValue(true);
    const bot = new MarketSeller();
    bot.onStop?.();
    expect(close).toHaveBeenCalledTimes(1);
});
