import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import Firemaker from '#/bot/scripts/Firemaker/Firemaker.js';

afterEach(() => mock.restore());

function fixture() {
    const state = { ready: true, logs: 20, packLogs: 0, deposited: false, generation: 1, waits: 0, withdrawals: 0, stops: [] as string[] };
    spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => [
        { id: 590, name: 'Tinderbox', count: 1, slot: 0, comId: 3214, ops: [] },
        ...Array.from({ length: state.packLogs }, (_, i) => ({ id: 1511, name: 'Logs', count: 1, slot: i + 1, comId: 3214, ops: [] }))
    ]);
    spyOn(Bank, 'openNearest').mockResolvedValue(true);
    spyOn(Bank, 'ready').mockImplementation(() => state.ready);
    spyOn(Bank, 'loaded').mockImplementation(() => state.logs > 0);
    spyOn(Bank, 'count').mockImplementation(name => name === 'Logs' ? state.logs : 0);
    spyOn(Bank, 'snapshotGeneration').mockImplementation(() => state.generation);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async () => { state.deposited = state.packLogs > 0; state.packLogs = 0; });
    spyOn(Bank, 'waitSnapshotAfter').mockImplementation(async generation => {
        state.waits++;
        if (!state.deposited || generation !== state.generation) return false;
        state.generation++;
        state.logs = 20;
        return true;
    });
    spyOn(Bank, 'withdrawX').mockImplementation(async () => { state.withdrawals++; return false; });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(ScriptRunner, 'stop').mockImplementation(reason => { state.stops.push(reason); });
    const bot = new Firemaker();
    bot.bindLog(() => {});
    return { bot, state };
}

test('ready empty stock stops on the first bank trip', async () => {
    const { bot, state } = fixture();
    state.logs = 0;
    await bot.loop();
    expect(state.stops).toEqual(['no Logs left in the bank']);
});

test('three stock-present withdrawal failures stop with a withdrawal reason', async () => {
    const { bot, state } = fixture();
    await bot.loop();
    await bot.loop();
    expect(state.stops).toEqual([]);
    await bot.loop();
    expect(state.withdrawals).toBe(3);
    expect(state.stops).toEqual(['could not withdraw Logs']);
    expect(state.waits).toBe(0);
});

test('deposit stock is refreshed before deciding that logs are exhausted', async () => {
    const { bot, state } = fixture();
    state.logs = 0;
    state.packLogs = 1;
    await bot.loop();
    expect(state.waits).toBe(1);
    expect(state.withdrawals).toBe(1);
    expect(state.stops).toEqual([]);
});

test('an unready bank does not consume a withdrawal retry', async () => {
    const { bot, state } = fixture();
    state.ready = false;
    await bot.loop();
    expect(state.withdrawals).toBe(0);
    expect(state.stops).toEqual([]);
});

test('a timed-out deposit keeps stock checks blocked across empty-pack retries', async () => {
    const { bot, state } = fixture();
    state.logs = 0;
    state.packLogs = 1;
    let refreshed = false;
    const wait = spyOn(Bank, 'waitSnapshotAfter').mockImplementation(async generation => {
        expect(generation).toBe(1);
        if (refreshed) state.logs = 20;
        return refreshed;
    });
    const deposit = spyOn(Bank, 'depositAllMatching').mockImplementation(async () => { state.packLogs = 0; });
    await bot.loop();
    await bot.loop();
    expect(wait).toHaveBeenCalledTimes(2);
    expect(state.withdrawals).toBe(0);
    expect(state.stops).toEqual([]);
    refreshed = true;
    await bot.loop();
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(state.withdrawals).toBe(1);
    expect(state.stops).toEqual([]);
});
