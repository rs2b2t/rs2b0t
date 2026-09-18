import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import PotionMaker from '#/bot/scripts/PotionMaker/PotionMaker.js';

const VIAL = 227;
const GUAM = 249;
const UNFINISHED = 91;
const EYE = 221;

afterEach(() => mock.restore());

async function fixture() {
    const state = { open: false, closeFails: 0, withdrawFails: 0, ready: true, stops: [] as string[], withdrawals: [] as number[] };
    const pack = new Map<number, number>();
    const stock = new Map([[VIAL, 28], [GUAM, 28], [EYE, 28]]);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(reader, 'inventory').mockImplementation(() => [...pack].flatMap(([id, count]) => Array.from({ length: count }, (_, slot) => ({ id, name: String(id), count: 1, slot, comId: 3214, ops: [] }))));
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
    bot.settings = new SettingsBag({ herb: 'Guam leaf', secondary: 'Eye of newt' });
    bot.bindLog(() => {});
    await bot.onStart();
    return { bot, state, pack, stock };
}

test('failed close after restocking is retried with a loaded pack', async () => {
    const { bot, state, pack } = await fixture();
    state.closeFails = 1;
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(pack.get(GUAM)).toBe(14);
    expect(state.withdrawals).toEqual([VIAL, GUAM]);
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
