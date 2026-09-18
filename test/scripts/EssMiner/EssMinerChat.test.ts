import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type ChatLine } from '#/bot/adapter/ClientAdapter.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { bus } from '#/bot/api/events/EventBus.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import Tile from '#/bot/geometry/Tile.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import EssMiner from '#/bot/scripts/EssMiner/EssMiner.js';

class Miner extends EssMiner {
    readonly registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

const shouted = 'The door demands a pink skirt majority need to have completed the rune mysteries';
const refusal = 'You need to have completed the Rune Mysteries Quest to use this teleport.';
let bot: Miner;
let teleport: Task;
let response: ChatLine | null;
let stops: string[];
let tile: Tile;

beforeEach(async () => {
    response = null;
    stops = [];
    tile = new Tile(3253, 3402, 0);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(1);
    spyOn(reader, 'questStatuses').mockReturnValue([
        { name: 'Rune Mysteries Quest', colour: 0x00f800, comId: 1 }
    ]);
    spyOn(reader, 'npcs').mockReturnValue([{
        index: 1, id: 553, anim: -1, name: 'Aubury', level: 0, size: 1,
        tile, distance: 1, ops: ['Teleport'], inCombat: false,
        health: 0, totalHealth: 0, faceEntity: -1
    }]);
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Npc.prototype, 'interact').mockImplementation(async () => {
        if (response) bus.emit('chat.message', response);
        return true;
    });
    spyOn(ScriptRunner, 'stop').mockImplementation(reason => { stops.push(reason); });
    bot = new Miner();
    bot.settings = new SettingsBag({ purgePackOnStart: false });
    bot.bindLog(() => {});
    await bot.onStart();
    teleport = bot.registered.find(task => task.constructor.name === 'TeleportIn')!;
});

afterEach(() => {
    bot?.disposeSubscriptions();
    mock.restore();
});

test.each([1, 2, 3, 6, 7])('player chat type %i cannot turn a teleport timeout into a quest refusal', async type => {
    response = { type, username: 'Aubury', text: shouted };
    bus.emit('chat.message', response);
    bus.emit('chat.message', response);
    expect(bot.questRefused).toBe(false);
    await teleport.execute();
    expect(stops).toEqual([]);
    expect(bot.questRefused).toBe(false);
});

test('a message with a player sender is not a game refusal', async () => {
    response = { type: 0, username: 'Aubury', text: refusal };
    await teleport.execute();
    expect(stops).toEqual([]);
});

test.each(['', null])('a genuine game refusal with sender %j stops the failed attempt', async username => {
    response = { type: 0, username, text: refusal };
    await teleport.execute();
    expect(stops).toHaveLength(1);
    expect(stops[0]).toContain('Rune Mysteries is not complete');
});

test('a refusal from before the teleport attempt cannot cancel its retries', async () => {
    bus.emit('chat.message', { type: 0, username: '', text: refusal });
    await teleport.execute();
    expect(stops).toEqual([]);
});

test('a successful teleport does not carry a refusal into the next trip', async () => {
    response = { type: 0, username: '', text: refusal };
    tile = new Tile(2900, 4820, 0);
    await teleport.execute();
    expect(stops).toEqual([]);
    response = null;
    tile = new Tile(3253, 3402, 0);
    await teleport.execute();
    expect(stops).toEqual([]);
});

test('unrelated game messages preserve the normal three-attempt timeout limit', async () => {
    response = { type: 0, username: '', text: 'Nothing interesting happens.' };
    await teleport.execute();
    await teleport.execute();
    expect(stops).toEqual([]);
    await teleport.execute();
    expect(stops).toEqual(['teleport did not land after 3 attempts']);
});
