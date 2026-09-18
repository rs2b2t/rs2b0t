import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import '#/bot/scripts/index.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Reach } from '#/bot/api/walking/Reach.js';

let pots: number;
let flour: number;
let banked: number;
let stock: number;
let bankOpen: boolean;

function bot(): LoopingBot {
    const instance = ScriptRegistry.get('FlourCollector')?.create();
    expect(instance).toBeInstanceOf(LoopingBot);
    if (!(instance instanceof LoopingBot)) throw new Error('FlourCollector missing');
    instance.bindLog(() => {});
    return instance;
}

beforeEach(() => {
    pots = 0;
    flour = 0;
    banked = 0;
    stock = 100;
    bankOpen = false;
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 2725, z: 3491, level: 0 });
    spyOn(Quests, 'status').mockReturnValue('inProgress');
    spyOn(ScriptRunner, 'stop').mockImplementation(() => {});
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Banking, 'open').mockImplementation(async () => { bankOpen = true; return true; });
    spyOn(Bank, 'isOpen').mockImplementation(() => bankOpen);
    spyOn(Bank, 'ready').mockReturnValue(true);
    spyOn(Bank, 'close').mockImplementation(async () => { bankOpen = false; return true; });
    spyOn(Bank, 'setNoteMode').mockResolvedValue();
    spyOn(Bank, 'countById').mockImplementation(id => id === 1931 ? stock : 0);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        expect(predicate('Pot of flour', 1933)).toBe(true);
        expect(predicate('Pot', 1931)).toBe(false);
        banked += flour;
        flour = 0;
    });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, count) => {
        expect(id).toBe(1931);
        const take = Math.min(stock, count);
        pots += take;
        stock -= take;
        return take > 0;
    });
    spyOn(Inventory, 'countById').mockImplementation(id => id === 1931 ? pots : id === 1933 ? flour : 0);
    spyOn(Inventory, 'free').mockImplementation(() => 28 - pots - flour);
    spyOn(Reach, 'locOp').mockImplementation(async opts => {
        expect(bankOpen).toBe(false);
        expect(opts.id).toBe(2662);
        expect(opts.op).toBe('Take From');
        pots--;
        flour++;
        expect(opts.expect()).toBe(true);
        return 'done';
    });
});

afterEach(() => mock.restore());

test('withdraws unnoted pots, fills a load, and banks it before taking the next load', async () => {
    const instance = bot();
    for (let pass = 0; pass < 60 && banked === 0; pass++) await instance.loop();
    expect(banked).toBe(28);
    expect(Bank.setNoteMode).toHaveBeenCalledWith(false);
    expect(Bank.withdrawXById).toHaveBeenCalledTimes(2);
    expect(ScriptRunner.stop).not.toHaveBeenCalled();
});

test('resumes filling carried pots with the bank closed', async () => {
    pots = 2;
    bankOpen = true;
    await bot().loop();
    expect(flour).toBeGreaterThan(0);
    expect(Banking.open).not.toHaveBeenCalled();
    expect(bankOpen).toBe(false);
});

test('banks the final flour before stopping when pots run out', async () => {
    flour = 28;
    stock = 0;
    await bot().loop();
    expect(banked).toBe(28);
    expect(ScriptRunner.stop).toHaveBeenCalledTimes(1);
    expect(bankOpen).toBe(false);
});

test('does not read a loading bank as exhausted', async () => {
    spyOn(Bank, 'ready').mockReturnValue(false);
    stock = 0;
    await bot().loop();
    expect(Bank.withdrawXById).not.toHaveBeenCalled();
    expect(ScriptRunner.stop).not.toHaveBeenCalled();
});

test('requires the guards permission before collecting flour', async () => {
    spyOn(Quests, 'status').mockReturnValue('notStarted');
    await bot().onStart?.();
    expect(ScriptRunner.stop).toHaveBeenCalledWith(expect.stringContaining('Murder Mystery'));
    expect(Banking.open).not.toHaveBeenCalled();
});

test('retries a refused barrel without discarding pots', async () => {
    pots = 5;
    spyOn(Reach, 'locOp').mockResolvedValue('retry');
    await bot().loop();
    expect(pots).toBe(5);
    expect(flour).toBe(0);
    expect(ScriptRunner.stop).not.toHaveBeenCalled();
});
