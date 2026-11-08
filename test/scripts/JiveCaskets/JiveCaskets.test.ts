import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import JiveCaskets from '#/bot/scripts/JiveCaskets/JiveCaskets.js';

afterEach(() => mock.restore());

function item(id: number, count = 1): InvItemSnapshot {
    return { id, count, name: id === 405 || id === 2714 ? 'Casket' : 'Loot', slot: 0, comId: 3214, ops: ['Open'] };
}

async function fixture(stock = 30) {
    const state = {
        pack: [] as InvItemSnapshot[], bank: new Map([[405, stock]]), open: false, ready: true,
        sideReady: true, dialog: false, clicks: [] as number[], stops: [] as string[], notes: true
    };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3185, z: 3440, level: 0 });
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.sideReady ? state.pack : []);
    spyOn(Banking, 'open').mockImplementation(async () => { state.dialog = false; state.open = true; return true; });
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.ready);
    spyOn(Bank, 'backpackReady').mockImplementation(async () => state.sideReady);
    spyOn(Bank, 'countById').mockImplementation(id => state.ready ? state.bank.get(id) ?? 0 : 0);
    spyOn(Bank, 'depositInventory').mockImplementation(async () => {
        for (const i of state.pack) state.bank.set(i.id, (state.bank.get(i.id) ?? 0) + i.count);
        state.pack = [];
    });
    spyOn(Bank, 'setNoteMode').mockImplementation(async notes => { state.notes = notes; });
    spyOn(Bank, 'withdrawLoad').mockImplementation(async id => {
        expect(id).toBe(405);
        expect(state.notes).toBe(false);
        const count = Math.min(28 - state.pack.length, state.bank.get(405) ?? 0);
        state.bank.set(405, (state.bank.get(405) ?? 0) - count);
        state.pack.push(...Array.from({ length: count }, () => item(405)));
        return count > 0;
    });
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(ChatDialog, 'canContinue').mockImplementation(() => state.dialog);
    spyOn(ChatDialog, 'continue').mockImplementation(async () => { state.dialog = false; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, action) {
        expect(state.open).toBe(false);
        expect(action).toBe('Open');
        state.clicks.push(this.id);
        state.pack.splice(state.pack.indexOf(this.snap), 1, item(1623));
        state.dialog = true;
        return true;
    });
    const bot = new JiveCaskets();
    bot.bindLog(() => {});
    bot.bindFinish(reason => state.stops.push(reason));
    await bot.onStart();
    return { bot, state };
}

test('deposits the starting inventory and withdraws a full load of ordinary caskets as items', async () => {
    const { bot, state } = await fixture();
    state.pack = [item(995, 100), item(2714)];
    await bot.loop();
    expect(state.pack.map(i => i.id)).toEqual(Array(28).fill(405));
    expect(state.bank.get(995)).toBe(100);
    expect(state.bank.get(2714)).toBe(1);
    expect(state.bank.get(405)).toBe(2);
    expect(state.open).toBe(false);
});

test('sends five distinct Open actions before waiting for the batch', async () => {
    const { bot, state } = await fixture(0);
    state.pack = Array.from({ length: 8 }, (_, slot) => ({ ...item(405), slot }));
    const pending: InvItemSnapshot[] = [];
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        pending.push(this.snap);
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => {
        expect(pending.map(i => i.slot)).toEqual([0, 1, 2, 3, 4]);
        expect(condition()).toBe(false);
        for (const casket of pending) state.pack.splice(state.pack.indexOf(casket), 1, item(1623));
        expect(condition()).toBe(true);
        return true;
    });
    await bot.loop();
    expect(pending).toHaveLength(5);
    expect(bot['opened']).toBe(5);
    expect(Execution.delayUntilTicks).toHaveBeenCalledTimes(1);
    expect(ChatDialog.continue).not.toHaveBeenCalled();
});

test('opens the remaining short batch despite the previous reward message', async () => {
    const { bot, state } = await fixture(0);
    state.pack = [item(405), item(405), item(405)];
    state.dialog = true;
    await bot.loop();
    expect(state.clicks).toEqual([405, 405, 405]);
    expect(bot['opened']).toBe(3);
    expect(ChatDialog.continue).not.toHaveBeenCalled();
    await bot.loop();
    expect(ChatDialog.continue).not.toHaveBeenCalled();
    expect(state.bank.get(1623)).toBe(3);
    expect(state.stops).toHaveLength(1);
});

test('counts a partly accepted batch and retries only caskets still held', async () => {
    const { bot, state } = await fixture(0);
    state.pack = Array.from({ length: 5 }, (_, slot) => ({ ...item(405), slot }));
    const clicked: number[] = [];
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        clicked.push(this.slot);
        if (this.slot < 2 || clicked.length > 5) state.pack.splice(state.pack.indexOf(this.snap), 1, item(1623));
        return true;
    });
    await bot.loop();
    expect(bot['opened']).toBe(2);
    expect(state.stops).toEqual([]);
    await bot.loop();
    expect(clicked).toEqual([0, 1, 2, 3, 4, 2, 3, 4]);
    expect(bot['opened']).toBe(5);
});

test('opens every casket and banks the last rewards without dismissing reward messages', async () => {
    const { bot, state } = await fixture();
    for (let i = 0; i < 100 && state.stops.length === 0; i++) await bot.loop();
    expect(state.clicks).toEqual(Array(30).fill(405));
    expect(state.bank.get(1623)).toBe(30);
    expect(state.pack).toEqual([]);
    expect(state.dialog).toBe(false);
    expect(state.open).toBe(false);
    expect(state.stops).toHaveLength(1);
    expect(ChatDialog.continue).not.toHaveBeenCalled();
});

test.each(['ready', 'sideReady'] as const)('waits for %s before treating bank stock as empty or depositing', async key => {
    const { bot, state } = await fixture(0);
    state.pack = [item(1623)];
    state[key] = false;
    await bot.loop();
    expect(state.stops).toEqual([]);
    expect(state.pack).toHaveLength(1);
    state[key] = true;
    await bot.loop();
    expect(state.bank.get(1623)).toBe(1);
    expect(state.stops).toHaveLength(1);
});

test('retries an incomplete deposit before withdrawing or finishing', async () => {
    const { bot, state } = await fixture();
    state.pack = [item(1623)];
    spyOn(Bank, 'depositInventory').mockResolvedValue(undefined);
    await bot.loop();
    expect(Bank.withdrawLoad).not.toHaveBeenCalled();
    expect(state.stops).toEqual([]);
});

test('retries a failed withdrawal without declaring the bank empty', async () => {
    const { bot, state } = await fixture();
    spyOn(Bank, 'withdrawLoad').mockResolvedValueOnce(false);
    await bot.loop();
    expect(state.stops).toEqual([]);
    await bot.loop();
    expect(state.pack).toHaveLength(28);
});

test('retries closing the bank without redepositing the withdrawn caskets', async () => {
    const { bot, state } = await fixture();
    spyOn(Bank, 'close').mockResolvedValueOnce(false);
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(state.pack).toHaveLength(28);
    expect(Bank.withdrawLoad).toHaveBeenCalledTimes(1);
});

test('closes an empty bank successfully before finishing', async () => {
    const { bot, state } = await fixture(0);
    spyOn(Bank, 'close').mockResolvedValueOnce(false);
    await bot.loop();
    expect(state.stops).toEqual([]);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(state.stops).toHaveLength(1);
});

test('retries a casket that was not consumed and stops after repeated failures', async () => {
    const { bot, state } = await fixture(0);
    state.pack = [item(405)];
    spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    for (let i = 0; i < 3; i++) await bot.loop();
    expect(state.pack[0].id).toBe(405);
    expect(state.stops).toHaveLength(1);
    expect(state.stops[0]).toContain('open');
});
