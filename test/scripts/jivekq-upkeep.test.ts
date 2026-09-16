import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type NpcSnapshot } from '../../src/bot/adapter/ClientAdapter.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Inventory } from '../../src/bot/api/inventory/Inventory.js';
import { Prayer, PROTECT_FROM_MAGIC } from '../../src/bot/api/prayer/Prayer.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { Reachability } from '../../src/bot/event/webwalk/geometry/Reachability.js';
import { Party } from '../../src/bot/scripts/JiveKQ/party.js';
import * as route from '../../src/bot/scripts/JiveKQ/route.js';
import JiveKQ from '../../src/bot/scripts/JiveKQ/JiveKQ.js';
import * as supply from '../../src/bot/scripts/JiveKQ/supply.js';

afterEach(() => mock.restore());

function scene(npcs: NpcSnapshot[] = []) {
    const events: string[] = [];
    const bot = new JiveKQ();
    bot.stage = 'fight';
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Skills, 'effective').mockReturnValue(50);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Inventory, 'countById').mockReturnValue(10);
    spyOn(reader, 'npcs').mockReturnValue(npcs);
    spyOn(Prayer, 'points').mockReturnValue(99);
    spyOn(supply, 'eat').mockImplementation(async () => { events.push('eat'); return true; });
    spyOn(Prayer, 'clear').mockImplementation(async () => { events.push('clear'); });
    return { bot, events };
}

test('a visible respawn restores magic protection before food or potion upkeep', async () => {
    const { bot, events } = scene([{
        index: 1, id: 1158, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3476, z: 9498, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: false, health: 255, totalHealth: 255, faceEntity: -1
    }]);
    let protectedFromMagic = false;
    spyOn(Prayer, 'active').mockImplementation(() => protectedFromMagic);
    spyOn(Prayer, 'set').mockImplementation(async (name, on) => {
        expect(name).toBe(PROTECT_FROM_MAGIC); expect(on).toBe(true);
        protectedFromMagic = true; events.push('protect'); return true;
    });
    await bot['upkeep']();
    expect(events).toEqual(['protect']);
    await bot['upkeep']();
    expect(events).toEqual(['protect', 'eat']);
});

test('confirmed kill clears prayers before waiting upkeep', async () => {
    const { bot, events } = scene();
    bot['queenTracker'].killedAt = 1;
    await bot['upkeep']();
    expect(events).toEqual(['clear', 'eat']);
});

test('the transformation gap keeps protection active', async () => {
    const { bot, events } = scene();
    await bot['upkeep']();
    expect(events).toEqual(['eat']);
});


test('empty prayer points allow a restore dose before trying to enable protection', async () => {
    const { bot, events } = scene([{
        index: 1, id: 1158, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3476, z: 9498, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: false, health: 255, totalHealth: 255, faceEntity: -1
    }]);
    spyOn(Game, 'tile').mockReturnValue({ x: 3470, z: 9503, level: 0 });
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Prayer, 'points').mockReturnValue(0);
    spyOn(Prayer, 'active').mockReturnValue(false);
    spyOn(Prayer, 'set').mockImplementation(async () => { events.push('failed protect'); return false; });
    spyOn(supply, 'doses').mockReturnValue(4);
    spyOn(supply, 'drink').mockImplementation(async name => { events.push(name); return true; });
    await bot['upkeep']();
    expect(events).toEqual(['Prayer potion']);
});

test('a blocked cross pulls the queen into open space and tells the party', async () => {
    const { bot } = scene([{
        index: 1, id: 1160, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3477, z: 9509, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: false, health: 200, totalHealth: 255, faceEntity: -1
    }]);
    spyOn(Game, 'tile').mockReturnValue({ x: 3480, z: 9498, level: 0 });
    spyOn(Reachability, 'walkable').mockReturnValue(false);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    bot['observeQueen']();
    await bot['fight']();
    expect(bot.stage).toBe('fight');
    expect(bot['blocked']).toBe(true);
    expect(move).toHaveBeenCalledWith({ x: 3508, z: 9493, level: 0 });
});

test('a peer with a blocked cross pulls all four even before this client sees the queen', async () => {
    const { bot } = scene();
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', blocked: name === 'two', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    await bot['fight']();
    expect(bot.stage).toBe('fight');
    expect(move).toHaveBeenCalledWith({ x: 3508, z: 9493, level: 0 });
    expect(party.unsafe(1, Date.now())).toBe(false);
});

test('a blocked formation remains latched when the queen leaves view during the pull', () => {
    const npcs: NpcSnapshot[] = [{
        index: 1, id: 1160, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3477, z: 9509, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: false, health: 200, totalHealth: 255, faceEntity: -1
    }];
    const { bot } = scene(npcs);
    spyOn(Game, 'tile').mockReturnValue({ x: 3480, z: 9498, level: 0 });
    spyOn(Reachability, 'walkable').mockReturnValue(false);
    bot['observeQueen']();
    npcs.length = 0;
    bot['observeQueen']();
    expect(bot['blocked']).toBe(true);
    expect(bot['lure']).toEqual({ x: 3508, z: 9493, level: 0 });
});

test('a queen that never follows cannot hold the group in a lure forever', async () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    bot['lureAt'] = Date.now() - 15_001;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', blocked: name === 'two', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    await bot['fight']();
    expect(bot.stage).toBe('retreat');
    expect(bot.status).toBe('queen did not follow into open space');
});

test('a member still approaching the rope cannot release the team', async () => {
    const { bot } = scene();
    bot.stage = 'travel';
    bot['party'] = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    spyOn(Game, 'tile').mockReturnValue({ x: 3228, z: 3106, level: 0 });
    const walk = spyOn(route, 'walk').mockResolvedValue(true);
    spyOn(supply, 'drink').mockResolvedValue(true);
    await bot['gate']('surface');
    expect(bot.stage).toBe('travel');
    expect(walk).toHaveBeenCalledWith({ x: 3226, z: 3108, level: 0 }, 0, expect.any(Function));
});

test('antipoison preparation withdraws gate readiness until the sip finishes', async () => {
    const { bot } = scene();
    bot.stage = 'surface';
    bot['party'] = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    spyOn(Game, 'tile').mockReturnValue({ x: 3226, z: 3108, level: 0 });
    const stages: string[] = [];
    spyOn(supply, 'drink').mockImplementation(async () => { stages.push(bot.stage); return true; });
    await bot['gate']('surface');
    expect(stages).toEqual(['travel']);
});

test('a late upper-rope arrival becomes fight-ready before upkeep', async () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    bot.stage = 'upper';
    bot['descent'] = 'upper';
    bot['party'] = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    spyOn(Game, 'tile').mockReturnValue({ x: 3508, z: 9493, level: 0 });
    await bot.loop();
    expect<string>(bot.stage).toBe('fight');
    expect(bot.entries).toBe(1);
    await bot.loop();
    expect(bot.entries).toBe(1);
});

test('a member eating at the upper rope stops advertising gate readiness', async () => {
    const { bot } = scene();
    bot.stage = 'upper';
    spyOn(Game, 'tile').mockReturnValue({ x: 3508, z: 9497, level: 2 });
    const stages: string[] = [];
    spyOn(supply, 'eat').mockImplementation(async () => { stages.push(bot.stage); return true; });
    await bot['upkeep']();
    expect(stages).toEqual(['travel']);
});

test('a peer starting upkeep during rope placement prevents the entrance release', async () => {
    const { bot } = scene();
    bot.stage = 'surface';
    bot.trip = 1;
    bot['prepared'] = true;
    bot['lastDose'] = Date.now();
    const tile = { x: 3226, z: 3108, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'surface', tile }, Date.now());
    spyOn(reader, 'players').mockReturnValue(party.roster.slice(1).map((name, index) => ({ name, index, tile, distance: 0, inCombat: false, faceEntity: -1 })));
    spyOn(route, 'placeRope').mockImplementation(async () => {
        party.receive({ name: 'two', session: 'two', trip: 1, ready: true, stage: 'travel', tile }, Date.now());
        return true;
    });
    spyOn(route, 'ropeReady').mockReturnValue(true);
    spyOn(route, 'descend').mockResolvedValue(false);
    await bot['gate']('surface');
    expect(party.released('surface', 1, Date.now())).toBe(false);
});
