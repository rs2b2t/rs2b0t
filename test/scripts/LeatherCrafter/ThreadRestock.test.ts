import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type InvItemSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import LeatherCrafter from '#/bot/scripts/LeatherCrafter/LeatherCrafter.js';

afterEach(() => mock.restore());

function fixture(start: WorldTile) {
    let here = start;
    let bankOpen = true;
    let pending: number | null = null;
    const pack = new Map([[1733, 1]]);
    const bank = new Map([[995, 500], [1741, 500]]);
    const state = { stock: 100, rejectShop: false, shopVisits: [] as string[], bankVisits: [] as WorldTile[], stops: [] as string[] };
    const names: Record<number, string> = { 995: 'Coins', 1733: 'Needle', 1734: 'Thread', 1741: 'Leather' };
    const snaps = (items: Map<number, number>, comId: number, ops: string[]): InvItemSnapshot[] => [...items].filter(([, count]) => count > 0).flatMap(([id, count]) => Array.from({ length: id === 1741 ? count : 1 }, () => ({ id, name: names[id], count: id === 1741 ? 1 : count, slot: 0, comId, ops }))).map((item, slot) => ({ ...item, slot }));
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(reader, 'sceneState').mockReturnValue(2);
    spyOn(Skills, 'level').mockReturnValue(14);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(reader, 'inventory').mockImplementation(() => snaps(pack, 3214, []));
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockImplementation(() => bankOpen ? 5292 : -1);
    spyOn(reader, 'bankSideItems').mockImplementation(() => snaps(pack, 5064, ['Deposit-All']));
    spyOn(reader, 'countDialogOpen').mockImplementation(() => pending !== null);
    spyOn(Bank, 'items').mockImplementation(() => snaps(bank, 5382, ['Withdraw-X']));
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'isOpen').mockImplementation(() => bankOpen);
    spyOn(Bank, 'openNearest').mockImplementation(async () => { bankOpen = true; state.bankVisits.push(here); return true; });
    spyOn(Input, 'invButton').mockImplementation((id, _slot, comId) => {
        if (comId === 5064) {
            bank.set(id, (bank.get(id) ?? 0) + (pack.get(id) ?? 0));
            pack.delete(id);
        } else pending = id;
        return true;
    });
    spyOn(actions, 'answerCountDialog').mockImplementation(want => {
        if (pending === null) return false;
        const count = Math.min(want, bank.get(pending) ?? 0);
        pack.set(pending, (pack.get(pending) ?? 0) + count);
        bank.set(pending, (bank.get(pending) ?? 0) - count);
        pending = null;
        return true;
    });
    spyOn(actions, 'closeModal').mockImplementation(() => { bankOpen = false; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { here = tile; return true; });
    spyOn(Shop, 'open').mockImplementation(async name => { state.shopVisits.push(name); return !state.rejectShop; });
    spyOn(Shop, 'buy').mockImplementation(async (_name, want) => {
        const qty = Math.min(want, state.stock, Math.floor((pack.get(995) ?? 0) / 3));
        state.stock -= qty;
        pack.set(995, (pack.get(995) ?? 0) - 3 * qty);
        pack.set(1734, (pack.get(1734) ?? 0) + qty);
        return qty;
    });
    spyOn(Shop, 'close').mockResolvedValue(undefined);
    spyOn(ScriptRunner, 'stop').mockImplementation(reason => { state.stops.push(reason); });
    const bot = new LeatherCrafter();
    bot.settings = new SettingsBag({ leatherType: 'Leather', threadPerTrip: 100 });
    bot.bindLog(() => {});
    return { bot, state, pack, bank };
}

for (const [start, vendor] of [
    [{ x: 3269, z: 3167, level: 0 }, 'Dommik'],
    [{ x: 3013, z: 3355, level: 0 }, 'Rommik'],
    [{ x: 3185, z: 3440, level: 0 }, 'Fancy dress shop owner']
] as const) {
    test(`restocks thread from ${vendor} and returns to the original crafting bank`, async () => {
        const { bot, state, pack } = fixture(start);
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        await bot.loop();
        expect(state.stops).toEqual([]);
        expect(state.shopVisits).toEqual([vendor]);
        expect(state.bankVisits.at(-1)).toEqual(start);
        expect(pack.get(1734)).toBe(100);
        expect(pack.get(1741)).toBeGreaterThan(0);
    });
}

test('shop-open failure retries the funded trip without reopening the bank', async () => {
    const { bot, state } = fixture({ x: 3269, z: 3167, level: 0 });
    state.rejectShop = true;
    await bot.onStart();
    await bot.loop();
    await bot.loop();
    state.rejectShop = false;
    await bot.loop();
    expect(state.bankVisits).toHaveLength(1);
    expect(Inventory.countById(1734)).toBe(100);
    expect(state.stops).toEqual([]);
});

test('partial shop stock returns to crafting and preserves the rest of the coin float', async () => {
    const { bot, state, bank, pack } = fixture({ x: 3013, z: 3355, level: 0 });
    state.stock = 2;
    await bot.onStart();
    await bot.loop();
    await bot.loop();
    await bot.loop();
    expect(pack.get(1734)).toBe(2);
    expect(pack.get(1741)).toBeGreaterThan(0);
    expect(bank.get(995)).toBe(494);
    expect(state.shopVisits).toHaveLength(1);
});
