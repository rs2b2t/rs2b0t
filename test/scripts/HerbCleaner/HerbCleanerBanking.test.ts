import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import HerbCleaner from '#/bot/scripts/HerbCleaner/HerbCleaner.js';

const bots: HerbCleaner[] = [];
afterEach(() => {
    for (const bot of bots.splice(0)) bot.disposeSubscriptions();
    mock.restore();
});

function items(id: number, count: number): InvItemSnapshot[] {
    return Array.from({ length: count }, (_, slot) => ({ id, count: 1, slot, name: 'Herb', comId: 5382, ops: [] }));
}

async function fixture() {
    const state = { open: false, ready: true, sideReady: true, pack: [] as InvItemSnapshot[], stock: new Map([[199, 100]]), stops: [] as string[] };
    let now = 0;
    spyOn(Date, 'now').mockImplementation(() => now += 1000);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3185, z: 3440, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(20);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.sideReady ? state.pack : []);
    spyOn(Bank, 'openNearestAccess').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.ready);
    spyOn(Bank, 'backpackReady').mockImplementation(async () => state.sideReady);
    spyOn(Bank, 'snapshotReady').mockImplementation(() => state.ready);
    spyOn(Bank, 'items').mockImplementation(() => [...state.stock].flatMap(([id, count]) => count > 0 ? [{ ...items(id, 1)[0], count }] : []));
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        if (!state.sideReady) return;
        state.pack = state.pack.filter(item => {
            if (!match(item.name ?? '', item.id)) return true;
            state.stock.set(item.id, (state.stock.get(item.id) ?? 0) + item.count);
            return false;
        });
    });
    const withdraw = (id: number, count: number): boolean => {
        if (!state.ready) return false;
        const take = Math.min(count, 28 - state.pack.length, state.stock.get(id) ?? 0);
        state.stock.set(id, (state.stock.get(id) ?? 0) - take);
        state.pack.push(...items(id, take));
        return take > 0;
    };
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, count) => withdraw(id, count));
    spyOn(Bank, 'withdrawLoad').mockImplementation(async id => typeof id === 'number' && withdraw(id, 28));
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const bot = new HerbCleaner();
    bots.push(bot);
    bot.settings = new SettingsBag({ herbs: ['Guam leaf', 'Marrentill'] });
    bot.bindLog(() => {});
    bot.bindFinish(reason => state.stops.push(reason));
    await bot.onStart();
    return { bot, state };
}

test('deposits a partial clean pack before filling all 28 slots with unidentified herbs', async () => {
    const { bot, state } = await fixture();
    state.pack = items(249, 10);
    const quantity = spyOn(Bank, 'withdrawXById');
    await bot.loop();
    expect(state.stock.get(249)).toBe(10);
    expect(state.pack.map(item => item.id)).toEqual(Array(28).fill(199));
    expect(state.stock.get(199)).toBe(72);
    expect(state.open).toBe(false);
    expect(quantity).not.toHaveBeenCalled();
});

test('fills remaining slots from the next herb when the first stock runs out', async () => {
    const { bot, state } = await fixture();
    state.stock.set(199, 6);
    state.stock.set(201, 50);
    await bot.loop();
    expect(state.pack.filter(item => item.id === 199)).toHaveLength(6);
    expect(state.pack.filter(item => item.id === 201)).toHaveLength(22);
    expect(state.stock.get(201)).toBe(28);
});

test('deposits the final partial batch before stopping on an empty herb stock', async () => {
    const { bot, state } = await fixture();
    state.stock.clear();
    state.pack = items(249, 6);
    await bot.loop();
    await bot.loop();
    expect(state.pack).toEqual([]);
    expect(state.stock.get(249)).toBe(6);
    expect(state.open).toBe(false);
    expect(state.stops.length).toBeGreaterThan(0);
});

test('an unloaded bank retries without treating missing snapshots as empty stock', async () => {
    const { bot, state } = await fixture();
    state.ready = false;
    await bot.loop();
    expect(state.stops).toEqual([]);
    state.ready = true;
    await bot.loop();
    expect(state.pack).toHaveLength(28);
});

test('a failed close is retried without redepositing the loaded herbs', async () => {
    const { bot, state } = await fixture();
    spyOn(Bank, 'close').mockResolvedValueOnce(false).mockImplementation(async () => { state.open = false; return true; });
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(state.pack).toHaveLength(28);
    expect(state.stock.get(199)).toBe(72);
});

test('a late side snapshot cannot skip depositing the final clean batch', async () => {
    const { bot, state } = await fixture();
    state.stock.clear();
    state.pack = items(249, 6);
    state.sideReady = false;
    await bot.loop();
    expect(state.stops).toEqual([]);
    expect(bot.targets()).toHaveLength(2);
    state.sideReady = true;
    await bot.loop();
    expect(state.stock.get(249)).toBe(6);
    expect(state.pack).toEqual([]);
});

test('empty stock does not stop the script before a failed close is retried', async () => {
    const { bot, state } = await fixture();
    state.stock.clear();
    spyOn(Bank, 'close').mockResolvedValueOnce(false).mockImplementation(async () => { state.open = false; return true; });
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
});
