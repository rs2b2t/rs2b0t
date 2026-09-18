import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import Tile from '#/bot/geometry/Tile.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import RangingGuild from '#/bot/scripts/RangingGuild/RangingGuild.js';
import { JUDGE, JUDGE_SPAWN, JUDGE_STAND, SEERS_BANK } from '#/bot/scripts/RangingGuild/RangingGuildLogic.js';

let tile = SEERS_BANK;
let chat = -1;
let coins = 400;
let count = 0;
let stuck = false;
let stopped = '';
let logs: string[];

beforeEach(() => {
    tile = SEERS_BANK;
    chat = -1;
    coins = 400;
    count = 0;
    stuck = false;
    stopped = '';
    logs = [];
    let now = 0;
    spyOn(Date, 'now').mockImplementation(() => now += 1000);
    spyOn(reader, 'worldTile').mockImplementation(() => tile);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: -1, side: -1, chat }));
    spyOn(reader, 'chatContinueComId').mockImplementation(() => chat === 100 ? 101 : -1);
    spyOn(reader, 'chatOptions').mockImplementation(() => chat === 200 ? [{ comId: 201, text: "I'll give it a go." }] : []);
    spyOn(reader, 'varp').mockImplementation(id => id === 156 ? count : 0);
    spyOn(reader, 'inventory').mockImplementation(() => [{ id: 995, name: 'Coins', count: coins, slot: 0, comId: 1, ops: [] }]);
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
        coins -= 200;
        count = 1;
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
