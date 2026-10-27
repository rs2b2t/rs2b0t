import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveChests from '#/bot/scripts/JiveChests/JiveChests.js';

afterEach(() => mock.restore());

function item(id: number, slot: number, count = 1): InvItemSnapshot {
    return { id, count, name: id === 985 || id === 987 ? 'Half of a key' : 'Crystal key', slot, comId: 3214, ops: ['Drop'] };
}

async function fixture(teeth = 30, loops = 30) {
    const state = {
        pack: [] as InvItemSnapshot[], bank: new Map([[985, teeth], [987, loops]]),
        open: false, ready: true, sideReady: true, notes: true, stops: [] as string[], failWithdrawal: 0
    };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3185, 3440, 0));
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.sideReady ? state.pack : []);
    spyOn(Banking, 'open').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.ready);
    spyOn(Bank, 'backpackReady').mockImplementation(async () => state.sideReady);
    spyOn(Bank, 'countById').mockImplementation(id => state.ready ? state.bank.get(id) ?? 0 : 0);
    spyOn(Bank, 'depositInventory').mockImplementation(async () => {
        for (const i of state.pack) state.bank.set(i.id, (state.bank.get(i.id) ?? 0) + i.count);
        state.pack = [];
    });
    spyOn(Bank, 'setNoteMode').mockImplementation(async notes => { state.notes = notes; });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, count) => {
        if (state.failWithdrawal === id) { state.failWithdrawal = 0; return false; }
        expect(state.open).toBe(true);
        expect(state.notes).toBe(false);
        expect(count).toBeLessThanOrEqual(state.bank.get(id) ?? 0);
        expect(state.pack.length + count).toBeLessThanOrEqual(28);
        state.bank.set(id, state.bank.get(id)! - count);
        const start = state.pack.length;
        state.pack.push(...Array.from({ length: count }, (_, i) => item(id, start + i)));
        return true;
    });
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    spyOn(Input, 'useItemOnItem').mockImplementation((id, slot, _com, targetId, targetSlot) => {
        expect(state.open).toBe(false);
        expect([id, targetId].sort()).toEqual([985, 987]);
        expect(state.pack.some(i => i.id === id && i.slot === slot)).toBe(true);
        expect(state.pack.some(i => i.id === targetId && i.slot === targetSlot)).toBe(true);
        state.pack = state.pack.filter(i => i.slot !== slot && i.slot !== targetSlot);
        state.pack.push(item(989, Math.min(slot, targetSlot)));
        return true;
    });
    spyOn(Input, 'useItemOnLoc').mockReturnValue(false);
    spyOn(Input, 'heldOp').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(true);
    spyOn(ChatDialog, 'continue').mockResolvedValue(true);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    const bot = new JiveChests();
    bot.settings = new SettingsBag({ combineKeys: true });
    bot.bindLog(() => {});
    bot.bindFinish(reason => state.stops.push(reason));
    await bot.onStart();
    return { bot, state };
}

test('banks the starting inventory and withdraws fourteen of each half by ID', async () => {
    const { bot, state } = await fixture(1000, 1000);
    state.pack = [item(989, 0), item(995, 1, 100), item(559, 2, 10)];
    await bot.loop();
    expect(Inventory.countById(985)).toBe(14);
    expect(Inventory.countById(987)).toBe(14);
    expect(state.bank.get(989)).toBe(1);
    expect(state.bank.get(559)).toBe(10);
    expect(state.bank.get(995)).toBe(100);
    expect(state.open).toBe(false);
    expect(Input.heldOp).not.toHaveBeenCalled();
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(bot.recoveryAnchor()).toBeNull();
});

test('combines five distinct pairs before waiting, without dismissing dialogue', async () => {
    const { bot, state } = await fixture();
    await bot.loop();
    const pairs: number[][] = [];
    spyOn(Input, 'useItemOnItem').mockImplementation((_id, slot, _com, _target, targetSlot) => {
        pairs.push([slot, targetSlot]);
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => {
        expect(pairs).toEqual([[0, 14], [1, 15], [2, 16], [3, 17], [4, 18]]);
        expect(condition()).toBe(false);
        for (const [slot, targetSlot] of pairs) {
            state.pack = state.pack.filter(i => i.slot !== slot && i.slot !== targetSlot);
            state.pack.push(item(989, slot));
        }
        return condition();
    });
    await bot.loop();
    expect(Inventory.countById(989)).toBe(5);
    expect(ChatDialog.continue).not.toHaveBeenCalled();
});

test.each([[1000, 1000], [30, 35], [35, 30], [0, 20], [20, 0]])('combines %i teeth and %i loops through the final bank deposit', async (teeth, loops) => {
    const { bot, state } = await fixture(teeth, loops);
    for (let i = 0; i < 500 && !state.stops.length; i++) await bot.loop();
    const made = Math.min(teeth, loops);
    expect(state.bank.get(989) ?? 0).toBe(made);
    expect(state.bank.get(985)).toBe(teeth - made);
    expect(state.bank.get(987)).toBe(loops - made);
    expect(state.pack).toEqual([]);
    expect(state.open).toBe(false);
    expect(state.stops).toHaveLength(1);
    expect(Input.useItemOnLoc).not.toHaveBeenCalled();
    expect(ChatDialog.continue).not.toHaveBeenCalled();
});

test.each(['ready', 'sideReady'] as const)('waits for %s before depositing or stopping', async key => {
    const { bot, state } = await fixture(0, 0);
    state.pack = [item(989, 0)];
    state[key] = false;
    await bot.loop();
    expect(Bank.depositInventory).not.toHaveBeenCalled();
    expect(state.stops).toEqual([]);
    state[key] = true;
    await bot.loop();
    expect(state.bank.get(989)).toBe(1);
    expect(state.stops).toHaveLength(1);
});

test('retries an incomplete deposit before withdrawing', async () => {
    const { bot, state } = await fixture();
    state.pack = [item(989, 0)];
    spyOn(Bank, 'depositInventory').mockResolvedValueOnce(undefined);
    await bot.loop();
    expect(Bank.withdrawXById).not.toHaveBeenCalled();
    await bot.loop();
    expect(state.pack).toHaveLength(28);
});

test('waits across retries for deposited halves to appear in the bank snapshot', async () => {
    const { bot, state } = await fixture(0, 14);
    state.pack = Array.from({ length: 14 }, (_, slot) => item(985, slot));
    spyOn(Bank, 'depositInventory').mockImplementation(async () => { state.pack = []; });
    await bot.loop();
    await bot.loop();
    expect(state.stops).toEqual([]);
    expect(Bank.withdrawXById).not.toHaveBeenCalled();
    state.bank.set(985, 14);
    await bot.loop();
    expect(Inventory.countById(985)).toBe(14);
    expect(Inventory.countById(987)).toBe(14);
});

test('waits for the finished keys to appear in the bank before stopping', async () => {
    const { bot, state } = await fixture(0, 0);
    state.pack = [item(989, 0)];
    spyOn(Bank, 'depositInventory').mockImplementation(async () => { state.pack = []; });
    await bot.loop();
    expect(state.stops).toEqual([]);
    state.bank.set(989, 1);
    await bot.loop();
    expect(state.stops).toHaveLength(1);
});

test.each([985, 987])('recovers when the %i withdrawal fails', async failedId => {
    const { bot, state } = await fixture(14, 14);
    state.failWithdrawal = failedId;
    for (let i = 0; i < 20 && !state.stops.length; i++) await bot.loop();
    expect(state.bank.get(989)).toBe(14);
    expect(state.pack).toEqual([]);
    expect(state.stops).toHaveLength(1);
});

test('does not double-count withdrawn halves when a failed withdrawal leaves the bank snapshot behind', async () => {
    const { bot, state } = await fixture(14, 14);
    state.failWithdrawal = 987;
    let stale = true;
    spyOn(Bank, 'countById').mockImplementation(id => stale && id === 985 ? 14 : state.bank.get(id) ?? 0);
    await bot.loop();
    expect(Inventory.countById(985)).toBe(14);
    spyOn(Bank, 'depositInventory').mockImplementation(async () => {
        stale = false;
        for (const i of state.pack) state.bank.set(i.id, (state.bank.get(i.id) ?? 0) + i.count);
        state.pack = [];
    });
    for (let i = 0; i < 20 && !state.stops.length; i++) await bot.loop();
    expect(state.bank.get(989)).toBe(14);
    expect(state.stops).toHaveLength(1);
});

test('retries closing the bank before using the withdrawn halves', async () => {
    const { bot, state } = await fixture();
    spyOn(Bank, 'close').mockResolvedValueOnce(false);
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(Bank.withdrawXById).toHaveBeenCalledTimes(2);
    expect(Input.useItemOnItem).not.toHaveBeenCalled();
    await bot.loop();
    expect(Inventory.countById(989)).toBe(5);
});

test('retries unconsumed halves and stops after three attempts without progress', async () => {
    const { bot, state } = await fixture(14, 14);
    await bot.loop();
    spyOn(Input, 'useItemOnItem').mockReturnValue(true);
    for (let i = 0; i < 3; i++) await bot.loop();
    expect(state.stops).toHaveLength(1);
    expect(Inventory.countById(985)).toBe(14);
    expect(Inventory.countById(987)).toBe(14);
});
