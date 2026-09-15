import { afterEach, expect, mock, spyOn, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Input } from '#/bot/input/Input.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { BankCatch } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';

afterEach(() => mock.restore());

function fixture(hp = 50, target = 2, foodName = 'Lobster', heal = 12, container: string | null = null) {
    const bot = new GatheringBot();
    bot.settings = new SettingsBag({ food: foodName, foodWithdraw: target });
    bot['rockIds'] = new Set([2096]);
    bot['productKeywords'] = ['coal'];
    bot['gearKeep'] = ['Rune pickaxe', ...(target ? [foodName] : [])];
    bot['minerFood'] = target ? { name: foodName, target } : null;
    const state = {
        hp, bankOpen: false, stock: 100, deposited: 0, eaten: 0,
        closeOk: true, withdrawOk: true, eatOk: true,
        regenOnClose: 0, regenInsteadOfEating: false, staleSideAfterEat: false, rejectCleanup: false,
        pack: ['Rune pickaxe', ...Array<string>(27).fill('Coal')],
        events: [] as string[], home: [] as { hp: number; food: number }[]
    };
    const snapshots = (): InvItemSnapshot[] => state.pack.map((name, slot) => ({
        id: name === foodName ? 379 : name === 'Coal' ? 453 : name === container ? 1923 : 1275,
        name, slot, count: 1, comId: state.bankOpen ? 5064 : 3214,
        ops: state.bankOpen ? ['Deposit-1'] : name === foodName ? ['Eat'] : []
    }));
    spyOn(reader, 'inventory').mockImplementation(snapshots);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.staleSideAfterEat && state.eaten > 0 ? [] : snapshots());
    spyOn(reader, 'bankSideSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'inventorySnapshotReady').mockReturnValue(true);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: state.bankOpen ? 1 : -1, side: state.bankOpen ? 1 : -1, chat: -1 }));
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockImplementation(() => state.bankOpen ? 1 : -1);
    spyOn(Skills, 'level').mockReturnValue(80);
    spyOn(Skills, 'effective').mockImplementation(() => state.hp);
    spyOn(bot, 'log').mockImplementation(() => {});
    spyOn(bot, 'openScriptBank').mockImplementation(async () => { state.bankOpen = true; return true; });
    spyOn(bot, 'closeScriptBank').mockImplementation(async () => {
        if (state.closeOk) state.bankOpen = false;
        state.hp += state.regenOnClose;
        state.regenOnClose = 0;
        return state.closeOk;
    });
    spyOn(bot, 'tryUpgradeGatherToolAtBank').mockResolvedValue(false);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'count').mockImplementation(name => name.toLowerCase() === foodName.toLowerCase() ? state.stock : 0);
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, qty) => {
        expect(state.bankOpen).toBe(true);
        expect(name.toLowerCase()).toBe(foodName.toLowerCase());
        if (!state.withdrawOk || state.stock < qty) return false;
        state.stock -= qty;
        state.pack.push(...Array<string>(qty).fill(foodName));
        return true;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        expect(state.bankOpen).toBe(true);
        state.events.push('deposit');
        if (state.rejectCleanup && state.eaten > 0) return;
        state.pack = state.pack.filter(name => {
            if (!match(name, 0)) return true;
            if (name === 'Coal') state.deposited++;
            if (name === foodName) state.stock++;
            return false;
        });
    });
    spyOn(Input, 'heldOp').mockImplementation((_id, slot) => {
        expect(state.bankOpen).toBe(false);
        expect(state.pack[slot]).toBe(foodName);
        if (!state.eatOk) return false;
        if (state.regenInsteadOfEating) { state.hp++; return true; }
        state.events.push('eat');
        if (container) state.pack[slot] = container;
        else state.pack.splice(slot, 1);
        state.hp = Math.min(80, state.hp + heal);
        state.eaten++;
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const stop = spyOn(ScriptRunner, 'stop').mockImplementation(() => {});
    spyOn(bot, 'walkHomeIfNeeded').mockImplementation(async () => {
        state.events.push('home');
        state.home.push({ hp: state.hp, food: state.pack.filter(n => n === foodName).length });
        return true;
    });
    return { bot, state, stop, run: () => new BankCatch(bot).execute() };
}

test('banks coal, eats two lobsters at 50/80 HP, and replenishes the trip food before returning', async () => {
    const { state, run } = fixture();
    await run();
    expect(state.deposited).toBe(27);
    expect(state.eaten).toBe(2);
    expect(state.events[0]).toBe('deposit');
    expect(state.home).toEqual([{ hp: 74, food: 2 }]);
    expect(state.stock).toBe(96);
});

test.each([80, 74, 69])('does not eat at %i/80 HP when a full lobster heal will not fit', async hp => {
    const { state, run } = fixture(hp);
    await run();
    expect(state.eaten).toBe(0);
    expect(state.home).toEqual([{ hp, food: 2 }]);
});

test('eats one lobster when exactly 12 HP is missing', async () => {
    const { state, run } = fixture(68);
    await run();
    expect(state.eaten).toBe(1);
    expect(state.home).toEqual([{ hp: 80, food: 2 }]);
});

test('heals at the bank without carrying food when the trip target is zero', async () => {
    const { state, run } = fixture(50, 0);
    await run();
    expect(state.eaten).toBe(2);
    expect(state.home).toEqual([{ hp: 74, food: 0 }]);
    expect(state.stock).toBe(98);
});

test('leaves non-mining bank trips alone', async () => {
    const { bot, state, run } = fixture(50, 0);
    bot['rockIds'] = new Set();
    await run();
    expect(state.eaten).toBe(0);
    expect(state.home).toEqual([{ hp: 50, food: 0 }]);
});

test.each(['withdrawOk', 'closeOk', 'eatOk'] as const)('does not return to the mine when %s fails', async failure => {
    const { state, run, stop } = fixture();
    state[failure] = false;
    await run();
    expect(state.home).toEqual([]);
    expect(stop).toHaveBeenCalled();
});

test('deposits empty bowls before refilling a 27-food trip', async () => {
    const { state, run } = fixture(69, 27, 'Stew', 11, 'Bowl');
    await run();
    expect(state.eaten).toBe(1);
    expect(state.pack).not.toContain('Bowl');
    expect(state.home).toEqual([{ hp: 80, food: 27 }]);
});

test('rechecks the healing threshold after a regen tick while closing the bank', async () => {
    const { state, run } = fixture(68, 0);
    state.regenOnClose = 1;
    await run();
    expect(state.eaten).toBe(0);
    expect(state.home).toEqual([{ hp: 69, food: 0 }]);
    expect(state.stock).toBe(100);
});

test('a regen tick cannot substitute for consuming food', async () => {
    const { state, run, stop } = fixture(50, 0);
    state.regenInsteadOfEating = true;
    await run();
    expect(state.eaten).toBe(0);
    expect(state.home).toEqual([]);
    expect(stop).toHaveBeenCalled();
});

test('waits for the reopened bank backpack before declaring healing complete', async () => {
    const { state, run, stop } = fixture(68, 0);
    state.staleSideAfterEat = true;
    await run();
    expect(state.home).toEqual([]);
    expect(stop).toHaveBeenCalled();
});

test('banks leftover cake after one bite when the trip target is zero', async () => {
    const { state, run } = fixture(73, 0, 'Cake', 4, '2/3 cake');
    await run();
    expect(state.eaten).toBe(1);
    expect(state.pack).toEqual(['Rune pickaxe']);
    expect(state.home).toEqual([{ hp: 77, food: 0 }]);
});

test('does not leave with leftover cake when its deposit fails', async () => {
    const { state, run, stop } = fixture(73, 0, 'Cake', 4, '2/3 cake');
    state.rejectCleanup = true;
    await run();
    expect(state.home).toEqual([]);
    expect(stop).toHaveBeenCalled();
});
