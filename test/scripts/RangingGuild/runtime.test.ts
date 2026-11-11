import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import Tile from '#/bot/geometry/Tile.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import RangingGuild from '#/bot/scripts/RangingGuild/RangingGuild.js';
import { JUDGE, JUDGE_SPAWN, JUDGE_STAND, SEERS_BANK } from '#/bot/scripts/RangingGuild/RangingGuildLogic.js';

let tile = SEERS_BANK;
let chat = -1;
let coins = 400;
let count = 0;
let stuck = false;
let stopped = '';
let logs: string[];
let arrows = 0;

beforeEach(() => {
    tile = SEERS_BANK;
    chat = -1;
    coins = 400;
    count = 0;
    stuck = false;
    stopped = '';
    logs = [];
    arrows = 0;
    let now = 0;
    spyOn(Date, 'now').mockImplementation(() => now += 1000);
    spyOn(reader, 'worldTile').mockImplementation(() => tile);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: -1, side: -1, chat }));
    spyOn(reader, 'chatContinueComId').mockImplementation(() => chat === 100 ? 101 : -1);
    spyOn(reader, 'chatOptions').mockImplementation(() => chat === 200 ? [{ comId: 201, text: count > 0 ? "I'll take some." : "I'll give it a go." }] : []);
    spyOn(reader, 'varp').mockImplementation(id => id === 156 ? count : 0);
    spyOn(reader, 'inventory').mockImplementation(() => [
        { id: 995, name: 'Coins', count: coins, slot: 0, comId: 1, ops: [] },
        ...arrows > 0 ? [{ id: 882, name: 'Bronze arrow', count: arrows, slot: 1, comId: 1, ops: [] }] : []
    ]);
    spyOn(reader, 'equipment').mockReturnValue([{ id: 861, name: 'Magic shortbow', count: 1, slot: 3, comId: 1, ops: [] }]);
    spyOn(reader, 'npcs').mockImplementation(() => tile.distanceTo(JUDGE_SPAWN) > 10 ? [] : [{
        index: 1, id: 1, anim: -1, name: JUDGE, level: 0, size: 1, tile: JUDGE_SPAWN,
        distance: tile.distanceTo(JUDGE_SPAWN), ops: ['Talk-to'], inCombat: false, health: 1, totalHealth: 1, faceEntity: -1
    }]);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Traversal, 'walkResilient').mockImplementation(async destination => {
        tile = Tile.from(destination);
        return true;
    });
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Input, 'interactNpc').mockImplementation(() => {
        if (chat !== -1) return false;
        chat = 200;
        return true;
    });
    spyOn(Input, 'continueDialog').mockImplementation(() => {
        if (stuck) return false;
        chat = -1;
        return true;
    });
    spyOn(actions, 'ifButton').mockImplementation(id => {
        if (id !== 201 || chat !== 200) return false;
        if (count > 0) {
            coins -= 100;
            arrows += 10;
        } else {
            coins -= 200;
            count = 1;
        }
        chat = -1;
        return true;
    });
    spyOn(ScriptRunner, 'stop').mockImplementation(reason => { stopped = reason ?? ''; });
});

afterEach(() => mock.restore());

test('approaches an initially unloaded judge and pays without recording a failed talk', async () => {
    const bot = new RangingGuild();
    bot.bindLog(message => logs.push(message));
    await bot.loop();
    expect({ count, coins }).toEqual({ count: 1, coins: 200 });
    expect(logs.some(message => message.includes('could not talk to the judge'))).toBe(false);
});

test('dismisses a level-up page before approaching and paying the judge', async () => {
    chat = 100;
    const bot = new RangingGuild();
    bot.bindLog(message => logs.push(message));
    await bot.loop();
    expect({ count, coins, chat }).toEqual({ count: 1, coins: 200, chat: -1 });
});

test('standalone runs keep the default zero reserve and can spend their last 200 coins', async () => {
    coins = 200;
    const bot = new RangingGuild();
    bot.bindLog(message => logs.push(message));
    await bot.loop();
    expect({ count, coins }).toEqual({ count: 1, coins: 0 });
    expect(stopped).toBe('');
});

test('stalled level-up dialogue exhausts bounded recovery without paying for a round', async () => {
    tile = JUDGE_STAND;
    chat = 100;
    stuck = true;
    const bot = new RangingGuild();
    bot.bindLog(message => logs.push(message));
    for (let i = 0; i < 60 && !stopped; i++) await bot.loop();
    expect({ count, coins }).toEqual({ count: 0, coins: 400 });
    expect(logs.some(message => message.includes('the judge did not start a round'))).toBe(true);
    expect(stopped).toContain('gave up after 3 recoveries');
});

function delegated(coinsPerTrip = 10_000) {
    const bot = new RangingGuild();
    let finished = '';
    bot.bindLog(message => logs.push(message));
    bot.bindFinish(reason => { finished = reason; });
    bot.settings = new SettingsBag({ coinsPerTrip, coinsReserve: 200 });
    return { bot, finished: () => finished };
}

function bankCoins(initial: number) {
    let banked = initial;
    spyOn(Banking, 'open').mockResolvedValue(true);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'countById').mockImplementation(id => id === 995 ? banked : 0);
    spyOn(Bank, 'items').mockImplementation(() => [{ id: 995, name: 'Coins', count: banked, slot: 0, comId: 1, ops: ['Withdraw-All'] }]);
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, amount) => {
        if (id !== 995 || amount > banked) return false;
        banked -= amount;
        coins += amount;
        return true;
    });
    spyOn(Bank, 'withdrawById').mockImplementation(async id => {
        if (id !== 995) return false;
        coins += banked;
        banked = 0;
        return true;
    });
    spyOn(Bank, 'close').mockResolvedValue(true);
    return () => banked;
}

test('a delegated child finishes when its next round would spend the carried reserve', async () => {
    coins = 399;
    bankCoins(0);
    const run = delegated();
    await run.bot.loop();
    expect({ count, coins }).toEqual({ count: 0, coins: 399 });
    expect(run.finished()).toContain('out of coins');
    expect(stopped).toBe('');
});

test('a delegated child spends a full round budget and preserves the last 200 coins', async () => {
    bankCoins(0);
    const run = delegated();
    await run.bot.loop();
    expect({ count, coins }).toEqual({ count: 1, coins: 200 });
    count = 0;
    await run.bot.loop();
    expect(coins).toBe(200);
    expect(run.finished()).toContain('out of coins');
    expect(stopped).toBe('');
});

test('withdrawals leave the reserve banked and can spend the remaining carried coins', async () => {
    coins = 0;
    const banked = bankCoins(450);
    const run = delegated();
    await run.bot.loop();
    expect({ coins, banked: banked() }).toEqual({ coins: 250, banked: 200 });
    expect(run.finished()).toBe('');
    await run.bot.loop();
    expect({ count, coins, banked: banked() }).toEqual({ count: 1, coins: 50, banked: 200 });
    expect(stopped).toBe('');
});

test('an active round can bank then restock for 100 coins without a 200-coin entry loop', async () => {
    coins = 0;
    count = 1;
    const banked = bankCoins(350);
    const run = delegated();
    await run.bot.loop();
    expect({ coins, banked: banked() }).toEqual({ coins: 150, banked: 200 });
    expect(run.finished()).toBe('');
    await run.bot.loop();
    expect({ coins, arrows, banked: banked() }).toEqual({ coins: 50, arrows: 10, banked: 200 });
    expect(stopped).toBe('');
});

test('an active round finishes when a 100-coin restock would cross the reserve', async () => {
    coins = 250;
    count = 1;
    bankCoins(0);
    const run = delegated();
    await run.bot.loop();
    expect({ coins, arrows }).toEqual({ coins: 250, arrows: 0 });
    expect(run.finished()).toContain('out of coins');
    expect(stopped).toBe('');
});

test('an active round can spend exactly 100 coins while carrying its 200-coin reserve', async () => {
    coins = 300;
    count = 1;
    const run = delegated();
    await run.bot.loop();
    expect({ coins, arrows }).toEqual({ coins: 200, arrows: 10 });
    expect(run.finished()).toBe('');
    expect(stopped).toBe('');
});

test('a delegated child throws after exhausted recovery without stopping its parent', async () => {
    tile = JUDGE_STAND;
    chat = 100;
    stuck = true;
    const run = delegated();
    await expect((async () => {
        for (let i = 0; i < 60; i++) await run.bot.loop();
    })()).rejects.toThrow('gave up after 3 recoveries');
    expect(run.finished()).toBe('');
    expect(stopped).toBe('');
    expect(coins).toBe(400);
});

test('a delegated child throws after repeated bank failures without stopping its parent', async () => {
    coins = 0;
    spyOn(Banking, 'open').mockResolvedValue(false);
    const run = delegated();
    await expect((async () => {
        for (let i = 0; i < 4; i++) await run.bot.loop();
    })()).rejects.toThrow('could not open the Seers bank');
    expect(run.finished()).toBe('');
    expect(stopped).toBe('');
});

test('a delegated child throws when its bow is missing instead of requesting a resupply', async () => {
    coins = 0;
    bankCoins(500);
    spyOn(reader, 'equipment').mockReturnValue([]);
    spyOn(Bank, 'count').mockReturnValue(0);
    const run = delegated();
    await expect(run.bot.loop()).rejects.toThrow('no bow held, worn or banked');
    expect(run.finished()).toBe('');
    expect(stopped).toBe('');
});
