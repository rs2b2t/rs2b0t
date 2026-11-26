import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import PotionMaker from '#/bot/scripts/PotionMaker/PotionMaker.js';

const VIAL = 227;
const GUAM = 249;
const UNFINISHED = 91;
const EYE = 221;

afterEach(() => mock.restore());

async function fixture(herb = 'Guam leaf', secondary = 'Eye of newt') {
    const state = { open: false, closeFails: 0, withdrawFails: 0, ready: true, stops: [] as string[], withdrawals: [] as number[] };
    const pack = new Map<number, number>();
    const stock = new Map([[VIAL, 28], [GUAM, 28], [EYE, 28]]);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(reader, 'inventory').mockImplementation(() => [...pack]
        .flatMap(([id, count]) => Array<number>(count).fill(id))
        .map((id, slot) => ({ id, name: String(id), count: 1, slot, comId: 3214, ops: [] })));
    const mix = spyOn(InvItem.prototype, 'useOn').mockImplementation(function (this: InvItem, target) {
        if (state.open || !(target instanceof InvItem)) return false;
        const items = reader.inventory();
        if (items[this.slot]?.id !== this.id || items[target.slot]?.id !== target.id) return false;
        const product = [
            [GUAM, VIAL, UNFINISHED], [EYE, UNFINISHED, 121],
            [257, VIAL, 99], [231, 99, 139]
        ].find(([ingredient, solvent]) => ingredient === this.id && solvent === target.id)?.[2];
        if (!product) return false;
        pack.set(this.id, pack.get(this.id)! - 1);
        pack.set(target.id, pack.get(target.id)! - 1);
        pack.set(product, (pack.get(product) ?? 0) + 1);
        return true;
    });
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'openNearestAccess').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'ready').mockImplementation(() => state.ready);
    spyOn(Bank, 'countById').mockImplementation(id => stock.get(id) ?? 0);
    spyOn(Bank, 'snapshotGeneration').mockReturnValue(1);
    spyOn(Bank, 'waitSnapshotAfter').mockResolvedValue(true);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async () => { for (const [id, count] of pack) stock.set(id, (stock.get(id) ?? 0) + count); pack.clear(); });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, want) => {
        state.withdrawals.push(id);
        if (state.withdrawFails-- > 0) return false;
        const count = Math.min(want, stock.get(id) ?? 0);
        stock.set(id, (stock.get(id) ?? 0) - count);
        pack.set(id, (pack.get(id) ?? 0) + count);
        return count > 0;
    });
    spyOn(Bank, 'close').mockImplementation(async () => { if (state.closeFails-- > 0) return false; state.open = false; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(ScriptRunner, 'stop').mockImplementation(reason => { state.stops.push(reason); });
    const bot = new PotionMaker();
    bot.settings = new SettingsBag({ herb, secondary });
    bot.bindLog(() => {});
    await bot.onStart();
    return { bot, state, pack, stock, mix };
}

test('failed close after restocking is retried with a loaded pack', async () => {
    const { bot, state, pack } = await fixture();
    state.closeFails = 1;
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(pack.get(UNFINISHED)).toBe(14);
    expect(state.withdrawals).toEqual([VIAL, GUAM]);
});

test('finishing potions reopens the guild banker to deposit the batch', async () => {
    const { bot, state, pack } = await fixture();
    spyOn(Game, 'tile').mockReturnValue({ x: 2732, z: 3378, level: 2 });
    spyOn(Quests, 'status').mockReturnValue('complete');
    const npc = spyOn(Bank, 'openNpcAccess').mockImplementation(async () => { state.open = true; return true; });
    const booth = spyOn(Bank, 'openNearestAccess').mockResolvedValue(false);
    pack.set(UNFINISHED, 14);
    pack.set(EYE, 14);

    await bot.loop();

    expect(npc).toHaveBeenCalledTimes(2);
    expect(booth).not.toHaveBeenCalled();
    expect(pack.size).toBe(0);
    expect(state.open).toBe(true);
});

test('failed close after a secondary failure does not strand the unfinished batch', async () => {
    const { bot, state, pack } = await fixture();
    pack.set(UNFINISHED, 14);
    state.closeFails = 1;
    state.withdrawFails = 1;
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.withdrawals).toEqual([EYE, EYE]);
});

test('missing herb stops before withdrawing water', async () => {
    const { bot, state, stock } = await fixture();
    stock.delete(GUAM);
    await bot.loop();
    expect(state.withdrawals).toEqual([]);
    expect(state.stops).toEqual(['no Guam leaf in the bank']);
});

test('three secondary failures stop and close the bank', async () => {
    const { bot, state, pack } = await fixture();
    pack.set(UNFINISHED, 14);
    state.withdrawFails = 3;
    await bot.loop();
    await bot.loop();
    expect(state.stops).toEqual([]);
    await bot.loop();
    expect(state.stops).toEqual(['could not withdraw Eye of newt']);
    expect(state.open).toBe(false);
});

test('missing secondary closes the bank and preserves unfinished potions', async () => {
    const { bot, state, pack, stock } = await fixture();
    pack.set(UNFINISHED, 14);
    stock.delete(EYE);
    await bot.loop();
    expect(state.stops).toEqual(['no Eye of newt in the bank']);
    expect(state.open).toBe(false);
    expect(pack.get(UNFINISHED)).toBe(14);
});

test('a secondary already withdrawn is retained after a failed close', async () => {
    const { bot, state, pack, stock } = await fixture();
    pack.set(UNFINISHED, 14);
    stock.set(EYE, 14);
    state.closeFails = 1;
    await bot.loop();
    expect(pack.get(EYE)).toBe(14);
    await bot.loop();
    expect(state.stops).toEqual([]);
    expect(state.withdrawals).toEqual([EYE]);
});

test('an unready bank leaves the unfinished batch eligible to retry', async () => {
    const { bot, state, pack } = await fixture();
    pack.set(UNFINISHED, 14);
    state.ready = false;
    await bot.loop();
    expect(state.open).toBe(false);
    expect(state.withdrawals).toEqual([]);
    state.ready = true;
    state.withdrawFails = 1;
    await bot.loop();
    expect(state.withdrawals).toEqual([EYE]);
});

test('restock retains a timed-out deposit barrier after the backpack empties', async () => {
    const { bot, state, pack, stock } = await fixture();
    pack.set(VIAL, 14);
    stock.set(VIAL, 0);
    let refreshed = false;
    const wait = spyOn(Bank, 'waitSnapshotAfter').mockImplementation(async generation => {
        expect(generation).toBe(1);
        if (refreshed) stock.set(VIAL, 14);
        return refreshed;
    });
    const deposit = spyOn(Bank, 'depositAllMatching').mockImplementation(async () => { pack.clear(); });
    await bot.loop();
    await bot.loop();
    expect(wait).toHaveBeenCalledTimes(2);
    expect(state.withdrawals).toEqual([]);
    expect(state.stops).toEqual([]);
    refreshed = true;
    await bot.loop();
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(state.withdrawals).toEqual([VIAL, GUAM]);
    expect(state.stops).toEqual([]);
});

test('the final deposit barrier carries over into the next restock phase', async () => {
    const { bot, state, pack, stock } = await fixture();
    pack.set(UNFINISHED, 14);
    stock.set(VIAL, 0);
    let refreshed = false;
    const wait = spyOn(Bank, 'waitSnapshotAfter').mockImplementation(async generation => {
        expect(generation).toBe(1);
        if (refreshed) stock.set(VIAL, 14);
        return refreshed;
    });
    const deposit = spyOn(Bank, 'depositAllMatching').mockImplementation(async () => { pack.clear(); });
    await bot.loop();
    await bot.loop();
    expect(wait).toHaveBeenCalledTimes(2);
    expect(state.withdrawals).toEqual([EYE]);
    expect(state.stops).toEqual([]);
    refreshed = true;
    await bot.loop();
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(state.withdrawals).toEqual([EYE, VIAL, GUAM]);
    expect(state.stops).toEqual([]);
});

test('a deposit that sends nothing reopens and retries held ingredients after a failed close', async () => {
    const { bot, state, pack, stock } = await fixture();
    pack.set(VIAL, 14);
    stock.set(VIAL, 0);
    state.open = true;
    state.closeFails = 1;
    let generation = 1;
    spyOn(Bank, 'openNearestAccess').mockImplementation(async () => {
        if (!state.open) generation++;
        state.open = true;
        return true;
    });
    spyOn(Bank, 'snapshotGeneration').mockImplementation(() => generation);
    spyOn(Bank, 'waitSnapshotAfter').mockImplementation(async before => generation > before);
    const deposit = spyOn(Bank, 'depositAllMatching').mockImplementation(async () => {
        if (deposit.mock.calls.length === 1) return;
        stock.set(VIAL, pack.get(VIAL) ?? 0);
        pack.clear();
        generation++;
    });
    await bot.loop();
    await bot.loop();
    expect(state.open).toBe(false);
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(state.withdrawals).toEqual([]);
    expect(state.stops).toEqual([]);
    await bot.loop();
    expect(deposit).toHaveBeenCalledTimes(2);
    expect(state.withdrawals).toEqual([VIAL, GUAM]);
    expect(state.stops).toEqual([]);
});

test('banked unfinished potions are withdrawn before gathering another herb batch', async () => {
    const { bot, state, stock, pack } = await fixture();
    stock.delete(GUAM); stock.delete(VIAL);
    stock.set(UNFINISHED, 2);
    await bot.loop();
    expect(state.withdrawals).toEqual([UNFINISHED]);
    expect(pack.get(UNFINISHED)).toBe(2);
    expect(state.stops).toEqual([]);
    expect(state.open).toBe(false);
});

test('a quest output target limits brewing to the remaining bottles', async () => {
    const { bot, stock, pack } = await fixture();
    bot.settings = new SettingsBag({ outputId: 121, outputCount: 2 });
    stock.set(121, 1);
    await bot.loop();
    expect(pack.get(GUAM)).toBe(1);
    expect(pack.get(VIAL)).toBe(1);
});

test('brews ten prayer potions from a loaded pack of ten waters and fourteen Ranarr', async () => {
    const { bot, state, pack, stock, mix } = await fixture('Ranarr weed', 'Snape grass');
    stock.clear();
    stock.set(231, 10);
    pack.set(257, 14);
    pack.set(VIAL, 10);
    for (let i = 0; i < 40 && !state.stops.length; i++) await bot.loop();
    expect(stock.get(139)).toBe(10);
    expect(stock.get(257)).toBe(4);
    expect(state.stops).toEqual(['no vials of water in the bank']);
    expect(mix).toHaveBeenCalledTimes(20);
});

test.each([false, true])('stops when a mix makes no inventory progress (finishing: %s)', async finishing => {
    const { bot, state, pack } = await fixture('Ranarr weed', 'Snape grass');
    pack.set(finishing ? 99 : VIAL, 10);
    pack.set(finishing ? 231 : 257, 10);
    const mix = spyOn(InvItem.prototype, 'useOn').mockReturnValue(true);
    for (let i = 0; i < 4 && !state.stops.length; i++) await bot.loop();
    expect(state.stops).toEqual([finishing ? 'could not mix Snape grass with unfinished potions' : 'could not mix Ranarr weed with vials of water']);
    expect(mix).toHaveBeenCalledTimes(3);
});

test.each([[1, 3], [3, 1]])('restocks a matched batch from %i water and %i Kwuarm', async (vials, herbs) => {
    const { bot, stock, pack } = await fixture('Kwuarm', 'Limpwurt root');
    stock.set(VIAL, vials);
    stock.set(263, herbs);
    await bot.loop();
    expect(pack.get(VIAL)).toBe(1);
    expect(pack.get(263)).toBe(1);
});

test('finishes a stranded Kwuarm potion and banks the spare herbs when water runs out', async () => {
    const { bot, state, stock, pack } = await fixture('Kwuarm', 'Limpwurt root');
    stock.set(VIAL, 0);
    stock.set(225, 3);
    pack.set(263, 2);
    pack.set(105, 1);
    spyOn(InvItem.prototype, 'useOn').mockImplementation(function (this: InvItem, target) {
        if (this.id !== 225 || !(target instanceof InvItem) || target.id !== 105) return false;
        pack.delete(225);
        pack.delete(105);
        pack.set(157, 1);
        return true;
    });
    for (let i = 0; i < 5 && !state.stops.length; i++) await bot.loop();
    expect(stock.get(157)).toBe(1);
    expect(stock.get(263)).toBe(2);
    expect(state.stops).toEqual(['no vials of water in the bank']);
});
