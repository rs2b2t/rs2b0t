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
import { RandomEvents } from '../../src/bot/runtime/randomevents/RandomEvents.js';

afterEach(() => { RandomEvents.setIgnoredRandoms([]); mock.restore(); });

function scene(npcs: NpcSnapshot[] = []) {
    const events: string[] = [];
    const bot = new JiveKQ();
    bot.stage = 'fight';
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3488, z: 9496, level: 0 });
    spyOn(Skills, 'effective').mockReturnValue(50);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Inventory, 'countById').mockReturnValue(10);
    spyOn(reader, 'npcs').mockReturnValue(npcs);
    spyOn(Prayer, 'points').mockReturnValue(99);
    spyOn(Prayer, 'active').mockImplementation(name => name === PROTECT_FROM_MAGIC);
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(supply, 'eat').mockImplementation(async () => { events.push('eat'); return true; });
    spyOn(Prayer, 'clear').mockImplementation(async () => { events.push('clear'); });
    return { bot, events };
}

test('a genie cannot pause combat or emergency escape, and is handled again after reaching safety', () => {
    const { bot } = scene([{
        index: 10, id: 409, anim: -1, name: 'Genie', level: 0, size: 1,
        tile: { x: 3486, z: 9490, level: 0 }, distance: 1, ops: ['Talk-to'],
        inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
    }]);
    let tile = { x: 3487, z: 9490, level: 0 };
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(reader, 'worldTile').mockImplementation(() => tile);
    RandomEvents.setIgnoredRandoms(() => bot.ignoredRandoms());
    expect(RandomEvents.detect()).toBeNull();
    bot.stage = 'retreat';
    tile = { x: 2757, z: 3478, level: 0 };
    expect(RandomEvents.detect()).toBeNull();
    bot.stage = 'bank';
    expect(RandomEvents.detect()).toEqual({ kind: 'dialog', name: 'genie' });
});

test('picking a strange plant cannot block upkeep during a queen fight', () => {
    const { bot } = scene([{
        index: 10, id: 407, anim: -1, name: 'Strange plant', level: 0, size: 1,
        tile: { x: 3476, z: 9496, level: 0 }, distance: 1, ops: ['Pick-fruit'],
        inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
    }]);
    spyOn(Game, 'tile').mockReturnValue({ x: 3476, z: 9495, level: 0 });
    spyOn(reader, 'worldTile').mockReturnValue({ x: 3476, z: 9495, level: 0 });
    expect(RandomEvents.detect()).toEqual({ kind: 'pick', name: 'strange plant' });
    RandomEvents.setIgnoredRandoms(() => bot.ignoredRandoms());
    expect(RandomEvents.detect()).toBeNull();
});

test('walking between the ropes sips melee boosts without advertising gate readiness', async () => {
    const { bot } = scene();
    bot.stage = 'travel';
    bot['lastDose'] = Date.now();
    bot['walkTile'] = { x: 3484, z: 9510, level: 2 };
    spyOn(Game, 'tile').mockReturnValue({ x: 3486, z: 9510, level: 2 });
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(supply, 'worn').mockReturnValue(true);
    const boost = spyOn(supply, 'boost').mockResolvedValue(true);
    await bot['upkeep'](true);
    expect(boost).toHaveBeenCalledWith(true);
    expect(bot.stage).toBe('travel');
});

test('initial cavern potions wait for movement instead of delaying the first walk click', async () => {
    const { bot } = scene();
    bot.stage = 'travel';
    bot['party'] = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    let tile = { x: 3483, z: 9510, level: 2 };
    let rendered = tile;
    spyOn(Game, 'tile').mockImplementation(() => rendered);
    spyOn(reader, 'serverTile').mockImplementation(() => tile);
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(supply, 'worn').mockReturnValue(true);
    spyOn(supply, 'doses').mockReturnValue(4);
    const drink = spyOn(supply, 'drink').mockResolvedValue(true);
    const boost = spyOn(supply, 'boost').mockResolvedValue(true);
    spyOn(route, 'walk').mockImplementation(async () => {
        await bot['upkeep'](true);
        await bot['upkeep'](true);
        expect(drink).not.toHaveBeenCalled();
        expect(boost).not.toHaveBeenCalled();
        rendered = { ...tile, x: tile.x + 2 };
        await bot['upkeep'](true);
        expect(drink).not.toHaveBeenCalled();
        tile = { ...tile, x: tile.x + 2 };
        rendered = tile;
        await bot['upkeep'](true);
        expect(drink).toHaveBeenCalledWith('Superantipoison');
        expect(boost).not.toHaveBeenCalled();
        await bot['upkeep'](true);
        expect(boost).not.toHaveBeenCalled();
        tile = { ...tile, x: tile.x + 2 };
        rendered = tile;
        await bot['upkeep'](true);
        expect(boost).toHaveBeenCalledWith(true);
        return true;
    });
    await bot['upkeep']();
    await bot['gate']('upper');
});

test('observed poison is treated even before the cavern walk starts', async () => {
    const { bot } = scene();
    bot.stage = 'travel'; bot['poisoned'] = true;
    spyOn(Game, 'tile').mockReturnValue({ x: 3483, z: 9510, level: 2 });
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(supply, 'doses').mockReturnValue(4);
    const drink = spyOn(supply, 'drink').mockResolvedValue(true);
    await bot['upkeep']();
    expect(drink).toHaveBeenCalledWith('Superantipoison');
});

test('the surface rendezvous leaves initial antipoison for the cavern walk', async () => {
    const { bot } = scene();
    bot.stage = 'travel'; bot.trip = 1;
    bot['party'] = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    spyOn(Game, 'tile').mockReturnValue({ x: 3226, z: 3108, level: 0 });
    const drink = spyOn(supply, 'drink').mockResolvedValue(true);
    await bot['gate']('surface');
    expect(drink).not.toHaveBeenCalled();
    expect<string>(bot.stage).toBe('surface');
});

test('the surface walk saves combat boosts until after the first rope', async () => {
    const { bot } = scene();
    bot.stage = 'travel';
    spyOn(Game, 'tile').mockReturnValue({ x: 3270, z: 3110, level: 0 });
    spyOn(Skills, 'effective').mockReturnValue(99);
    const boost = spyOn(supply, 'boost').mockResolvedValue(true);
    await bot['upkeep'](true);
    expect(boost).not.toHaveBeenCalled();
});

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
    expect(events).toEqual(['protect', 'eat']);
});

test('confirmed kill clears prayers before waiting upkeep', async () => {
    const { bot, events } = scene();
    bot['queenTracker'].killedAt = 1;
    spyOn(Prayer, 'set').mockImplementation(async (name, on) => {
        expect(name).toBe(PROTECT_FROM_MAGIC); expect(on).toBe(false);
        events.push('clear'); return true;
    });
    await bot['upkeep']();
    expect(events).toEqual(['clear', 'eat']);
});

test('the transformation gap keeps protection active', async () => {
    const { bot, events } = scene();
    await bot['upkeep']();
    expect(events).toEqual(['eat']);
});

test('a level-70 player saves a shark until it can heal all twenty hitpoints', async () => {
    const { bot, events } = scene();
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Skills, 'effective').mockReturnValue(60);
    await bot['upkeep']();
    expect(events).toEqual([]);
    spyOn(Skills, 'effective').mockReturnValue(50);
    await bot['upkeep']();
    expect(events).toEqual(['eat']);
});

test('retreat cancels the old approach using the server position', () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    spyOn(Game, 'tile').mockReturnValue({ x: 3495, z: 9493, level: 0 });
    spyOn(reader, 'serverTile').mockReturnValue({ x: 3493, z: 9493, level: 0 });
    const movement: unknown[] = [];
    spyOn(route, 'step').mockImplementation(tile => { movement.push(tile); return true; });
    bot['retreat']('low health');
    expect(bot.stage).toBe('retreat');
    expect(movement).toEqual([{ x: 3493, z: 9493, level: 0 }]);
});

test('food exhaustion retires only that member from the current fight', () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    bot.trip = 1;
    bot['prepared'] = true;
    const tile = { x: 3473, z: 9498, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(route, 'step').mockReturnValue(true);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 70, food: 1, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile }, Date.now());
    expect(bot['checkSafety']()).toBe(true);
    expect(bot.restocking).toBe(true);
    expect(party.unsafe(1, Date.now())).toBe(false);
});

test('a genie targeting one fighter retires only that player before its warning teleport', () => {
    const { bot } = scene([{
        index: 10, id: 409, anim: -1, name: 'Genie', level: 0, size: 1,
        tile: { x: 3473, z: 9497, level: 0 }, distance: 1, ops: ['Talk-to'],
        inCombat: false, health: 0, totalHealth: 0, faceEntity: 32770
    }]);
    bot.bindLog(() => {});
    bot.trip = 1;
    bot['prepared'] = true;
    const tile = { x: 3473, z: 9498, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    const slot = spyOn(reader, 'selfSlot').mockReturnValue(1);
    spyOn(route, 'step').mockReturnValue(true);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 70, food: 10, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile }, Date.now());
    expect(bot['checkSafety']()).toBe(false);
    slot.mockReturnValue(2);
    expect(bot['checkSafety']()).toBe(true);
    expect(bot.status).toBe('Genie needs attention outside combat');
    expect(bot.restocking).toBe(true);
    expect(party.unsafe(1, Date.now())).toBe(false);
});

test('an owned visitor in the upper cavern aborts before releasing the second rope', () => {
    const { bot } = scene([{
        index: 10, id: 410, anim: -1, name: 'Mysterious old man', level: 0, size: 1,
        tile: { x: 3486, z: 9510, level: 2 }, distance: 1, ops: ['Talk-to'],
        inCombat: false, health: 0, totalHealth: 0, faceEntity: 32770
    }]);
    bot.bindLog(() => {});
    bot.stage = 'travel';
    bot.trip = 1;
    bot['prepared'] = true;
    const tile = { x: 3486, z: 9511, level: 2 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(reader, 'selfSlot').mockReturnValue(2);
    spyOn(route, 'step').mockReturnValue(true);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 70, food: 10, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'travel', tile }, Date.now());
    expect(bot['checkSafety']()).toBe(true);
    expect(bot.restocking).toBe(false);
    expect(party.unsafe(1, Date.now())).toBe(true);
});

test('a forced teleport during awaited upkeep recovers without trying another Shantay pass', async () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    bot.trip = 1;
    bot['prepared'] = true;
    let tile = { x: 3473, z: 9498, level: 0 };
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(route, 'step').mockReturnValue(true);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 55, food: 12, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile }, Date.now());
    spyOn(supply, 'eat').mockImplementation(async () => {
        tile = { x: 3287, z: 3190, level: 2 };
        return false;
    });
    const pass = spyOn(route, 'pass').mockResolvedValue(false);
    await bot.loop();
    expect(pass).not.toHaveBeenCalled();
    expect(bot.stage).toBe('retreat');
    expect(bot.restocking).toBe(true);
    expect(party.unsafe(1, Date.now())).toBe(false);
});

test('a displaced member uses the dueling ring before starting the bank route', async () => {
    const { bot } = scene();
    bot.stage = 'retreat';
    spyOn(Game, 'tile').mockReturnValue({ x: 3287, z: 3190, level: 2 });
    spyOn(Skills, 'effective').mockReturnValue(70);
    const ring = spyOn(route, 'duelArena').mockResolvedValue(false);
    await bot['escape']();
    expect(ring).toHaveBeenCalled();
    expect(bot.stage).toBe('retreat');
});

test('damage during escape healing must leave enough HP for another queen hit before casting', async () => {
    const { bot } = scene();
    bot.stage = 'retreat';
    let hp = 22;
    let food = 10;
    spyOn(Game, 'tile').mockReturnValue({ x: 3482, z: 9493, level: 0 });
    spyOn(Skills, 'effective').mockImplementation(() => hp);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Inventory, 'countById').mockImplementation(() => food);
    const eat = spyOn(supply, 'eat').mockImplementation(async () => {
        food--;
        hp += 20;
        if (food === 9) hp -= 26;
        return true;
    });
    const teleport = spyOn(route, 'camelot').mockResolvedValue(false);
    await bot['escape']();
    expect(hp).toBe(16);
    expect(teleport).not.toHaveBeenCalled();
    await bot['escape']();
    expect(hp).toBe(36);
    expect(eat).toHaveBeenCalledTimes(2);
    expect(teleport).not.toHaveBeenCalled();
    await bot['escape']();
    expect(hp).toBe(56);
    expect(teleport).toHaveBeenCalledTimes(1);
});

test('retreat retries an unconfirmed shark before locking food behind the teleport animation', async () => {
    const { bot } = scene();
    bot.stage = 'retreat';
    let hp = 46;
    let food = 1;
    let accepted = false;
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Skills, 'effective').mockImplementation(() => hp);
    spyOn(Inventory, 'countById').mockImplementation(() => food);
    spyOn(supply, 'eat').mockImplementation(async () => {
        if (accepted) { food--; hp += 20; }
        return accepted;
    });
    const teleport = spyOn(route, 'camelot').mockResolvedValue(false);
    await bot['escape']();
    expect(teleport).not.toHaveBeenCalled();
    accepted = true;
    hp = 23;
    await bot['escape']();
    expect(hp).toBe(43);
    expect(food).toBe(0);
    expect(teleport).toHaveBeenCalledTimes(1);
});

test('using the last shark still attempts escape when critical HP cannot be healed further', async () => {
    const { bot } = scene();
    bot.stage = 'retreat';
    let food = 1;
    spyOn(Game, 'tile').mockReturnValue({ x: 3482, z: 9493, level: 0 });
    spyOn(Skills, 'effective').mockReturnValue(16);
    spyOn(Inventory, 'countById').mockImplementation(() => food);
    spyOn(supply, 'eat').mockImplementation(async () => { food--; return true; });
    const teleport = spyOn(route, 'camelot').mockResolvedValue(false);
    await bot['escape']();
    expect(teleport).toHaveBeenCalledTimes(1);
});

test('a teammate banking independently does not hold the remaining fighters at the entry barrier', async () => {
    const { bot } = scene();
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile: { x: 3491, z: 9493, level: 0 } }, Date.now());
    party.receive({ name: 'two', session: 'two', trip: 1, ready: false, stage: 'bank', restocking: true, tile: { x: 3308, z: 3120, level: 0 } }, Date.now());
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(route, 'step').mockReturnValue(true);
    await bot['fight']();
    expect(bot.status).toBe('searching the queen chamber');
});

test('approaching a visible queen spreads into formation before optional attack prayers', async () => {
    const { bot, events } = scene([{
        index: 1, id: 1158, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3476, z: 9498, level: 0 }, distance: 15, ops: ['Attack'],
        inCombat: false, health: 255, totalHealth: 255, faceEntity: -1
    }]);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile: { x: 3491, z: 9493, level: 0 } }, Date.now());
    spyOn(Game, 'tile').mockReturnValue({ x: 3491, z: 9493, level: 0 });
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(Prayer, 'set').mockImplementation(async name => { events.push(name); return true; });
    spyOn(supply, 'worn').mockReturnValue(true);
    spyOn(Game, 'combatMode').mockReturnValue(1);
    spyOn(Game, 'combatStyles').mockReturnValue([{ mode: 1, label: 'Aggressive' }]);
    spyOn(route, 'step').mockImplementation(() => { events.push('move'); return true; });
    await bot['fight']();
    expect(events).toEqual(['move']);
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

test('a blocked cross first approaches an unengaged queen instead of running out of sight', async () => {
    const { bot } = scene([{
        index: 1, id: 1160, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3477, z: 9509, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: false, health: 200, totalHealth: 255, faceEntity: -1
    }]);
    spyOn(Game, 'tile').mockReturnValue({ x: 3480, z: 9498, level: 0 });
    spyOn(Reachability, 'walkable').mockImplementation(p => !(p.x > 3477 && p.z === 9509));
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    bot['observeQueen']();
    await bot['fight']();
    expect(bot.stage).toBe('fight');
    expect(bot['blocked']).toBe(true);
    const target = move.mock.calls.at(-1)?.[0];
    expect(target).toBeDefined();
    expect(Math.max(Math.abs(target!.x - 3477), Math.abs(target!.z - 9509))).toBe(6);
});

test('a peer shares the last queen position with a client that cannot see her', async () => {
    const { bot } = scene();
    bot.trip = 1;
    spyOn(Game, 'tile').mockReturnValue({ x: 3508, z: 9493, level: 0 });
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', blocked: name === 'two', tile: { x: 3480, z: 9498, level: 0 }, queen: name === 'two' ? { id: 1160, tile: { x: 3478, z: 9510, level: 0 }, at: Date.now(), engaged: false } : undefined }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    await bot['fight']();
    expect(bot.stage).toBe('fight');
    expect(bot.status).toBe('searching the last reported queen position');
    const target = move.mock.calls.at(-1)?.[0];
    expect(target).toBeDefined();
    expect(Math.max(Math.abs(target!.x - 3478), Math.abs(target!.z - 9510))).toBe(6);
    expect(party.unsafe(1, Date.now())).toBe(false);
});

test('an engaged queen is pulled along a route wide enough for her whole body', async () => {
    const { bot } = scene([{
        index: 1, id: 1160, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3477, z: 9509, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: true, health: 200, totalHealth: 255, faceEntity: 32769
    }]);
    bot.trip = 1;
    spyOn(reader, 'selfSlot').mockReturnValue(1);
    spyOn(Reachability, 'walkable').mockImplementation(p => !(p.x > 3477 && p.z === 9509));
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    const body = spyOn(Reachability, 'canStep').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    bot['observeQueen']();
    await bot['fight']();
    expect(bot['sighting']?.engaged).toBe(true);
    expect(move).toHaveBeenCalledWith({ x: 3477, z: 9495, level: 0 });
    expect(body).toHaveBeenCalledWith({ x: 3479, z: 9511, level: 0 }, { x: 3479, z: 9510, level: 0 });
});

test('reacquiring a stationary queen restarts the pull retry timer', async () => {
    const npcs: NpcSnapshot[] = [{
        index: 1, id: 1160, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3477, z: 9509, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: true, health: 200, totalHealth: 255, faceEntity: 32769
    }];
    const queen = npcs[0];
    const { bot } = scene(npcs);
    bot.trip = 1;
    let now = 100_000;
    spyOn(Date, 'now').mockImplementation(() => now);
    spyOn(reader, 'selfSlot').mockReturnValue(1);
    spyOn(Reachability, 'walkable').mockImplementation(p => !(p.x > 3477 && p.z === 9509));
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(Reachability, 'canStep').mockReturnValue(true);
    spyOn(route, 'step').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    const heartbeat = () => { for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile: { x: 3480, z: 9498, level: 0 } }, now); };
    heartbeat(); bot['observeQueen'](); await bot['fight']();
    npcs.length = 0;
    now += 9000;
    heartbeat(); bot['observeQueen'](); await bot['fight'](); await bot['fight']();
    expect(bot['lureAt']).toBe(0);
    npcs.push(queen);
    heartbeat(); bot['observeQueen'](); await bot['fight']();
    expect(bot['lureAt']).toBe(now);
    now += 16_000;
    heartbeat(); bot['observeQueen'](); await bot['fight']();
    expect(bot['lureAttempt']).toBe(1);
    expect(bot.stage).toBe('fight');
});

test('the last observed position is retained when a blocked queen leaves view', () => {
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
    expect(bot['sighting']?.tile).toEqual({ x: 3477, z: 9509, level: 0 });
});

test('queen aggression recognizes a teammate outside this clients player visibility', () => {
    const { bot } = scene([{
        index: 1, id: 1160, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3477, z: 9509, level: 0 }, distance: 6, ops: ['Attack'],
        inCombat: true, health: 200, totalHealth: 255, faceEntity: 32770
    }]);
    bot.trip = 1;
    spyOn(reader, 'players').mockReturnValue([]);
    spyOn(reader, 'selfSlot').mockReturnValue(1);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    party.receive({ name: 'two', session: 'two', playerSlot: 2, trip: 1, ready: true, stage: 'fight', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    bot['observeQueen']();
    expect(bot['sighting']?.engaged).toBe(true);
});

test('all followers adopt a changed pull route from the first active member', async () => {
    const { bot } = scene();
    bot.trip = 1;
    const party = new Party(['one', 'two', 'three', 'four'], 'two', 'two');
    bot['party'] = party;
    const leader = { name: 'one', session: 'one', trip: 1, ready: true, stage: 'fight', blocked: true, tile: { x: 3480, z: 9498, level: 0 }, queen: { id: 1160, tile: { x: 3478, z: 9510, level: 0 }, at: Date.now(), engaged: true }, lure: { x: 3478, z: 9495, level: 0 } };
    party.receive(leader, Date.now());
    for (const name of party.roster.slice(1)) party.receive({ ...leader, name, session: name, lure: undefined }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    await bot['fight']();
    expect(move).toHaveBeenLastCalledWith(leader.lure);
    leader.lure = { x: 3495, z: 9510, level: 0 };
    party.receive(leader, Date.now());
    await bot['fight']();
    expect(move).toHaveBeenLastCalledWith(leader.lure);
    expect(bot['lure']).toEqual(leader.lure);
});

test('an unsuccessful lure retries the search instead of teleporting away', async () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    bot['lureAt'] = Date.now() - 15_001;
    spyOn(Game, 'tile').mockReturnValue({ x: 3508, z: 9493, level: 0 });
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    const move = spyOn(route, 'step').mockReturnValue(true);
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', blocked: name === 'two', tile: { x: 3480, z: 9498, level: 0 } }, Date.now());
    await bot['fight']();
    expect(bot.stage).toBe('fight');
    expect(move).toHaveBeenCalled();
    expect(move.mock.calls.at(-1)?.[0]).not.toEqual({ x: 3508, z: 9493, level: 0 });
});

test('an empty central search waypoint advances into the chamber instead of waiting there', async () => {
    const { bot } = scene();
    const tile = { x: 3488, z: 9496, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile }, Date.now());
    const move = spyOn(route, 'step').mockReturnValue(true);
    await bot['fight']();
    expect(bot.stage).toBe('fight');
    expect(move.mock.calls.at(-1)?.[0]).not.toEqual(tile);
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

test('a fallback antipoison sip at the upper gate withdraws readiness until it finishes', async () => {
    const { bot } = scene();
    bot.stage = 'upper';
    bot['party'] = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    spyOn(Game, 'tile').mockReturnValue({ x: 3508, z: 9497, level: 2 });
    spyOn(supply, 'boostsReady').mockReturnValue(true);
    const stages: string[] = [];
    spyOn(supply, 'drink').mockImplementation(async () => { stages.push(bot.stage); return true; });
    await bot['gate']('upper');
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

test('a teammate delayed beyond the rope lifetime does not consume the leader ropes while waiting', async () => {
    const { bot } = scene();
    let now = 100_000;
    spyOn(Date, 'now').mockImplementation(() => now);
    bot.stage = 'surface'; bot.trip = 1; bot['prepared'] = true; bot['lastDose'] = now;
    const tile = { x: 3226, z: 3108, level: 0 };
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    let arrived = false;
    spyOn(reader, 'players').mockImplementation(() => party.roster.slice(1, arrived ? 4 : 3).map((name, index) => ({ name, index, tile, distance: 0, inCombat: false, faceEntity: -1, combatLevel: 70 })));
    const rope = spyOn(route, 'placeRope').mockResolvedValue(true);
    spyOn(route, 'ropeReady').mockReturnValue(true);
    const descend = spyOn(route, 'descend').mockResolvedValue(false);
    const heartbeat = () => {
        for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: name === 'four' && !arrived ? 'travel' : 'surface', tile }, now);
    };
    for (let i = 0; i < 3; i++) { heartbeat(); await bot['gate']('surface'); now += 41_000; }
    expect(rope).not.toHaveBeenCalled();
    expect(descend).not.toHaveBeenCalled();
    arrived = true; heartbeat(); await bot['gate']('surface');
    expect(rope).toHaveBeenCalledTimes(1);
    expect(descend).toHaveBeenCalledWith('surface');
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
    spyOn(reader, 'players').mockReturnValue(party.roster.slice(1).map((name, index) => ({ name, index, tile, distance: 0, inCombat: false, faceEntity: -1, combatLevel: 70 })));
    spyOn(route, 'placeRope').mockImplementation(async () => {
        party.receive({ name: 'two', session: 'two', trip: 1, ready: true, stage: 'travel', tile }, Date.now());
        return true;
    });
    spyOn(route, 'ropeReady').mockReturnValue(true);
    spyOn(route, 'descend').mockResolvedValue(false);
    await bot['gate']('surface');
    expect(party.released('surface', 1, Date.now())).toBe(false);
});

test('an accepted rope release takes priority over boosts that decay after readiness', async () => {
    const { bot } = scene();
    bot.bindLog(() => {});
    bot.stage = 'travel';
    bot.trip = 1;
    bot['prepared'] = true;
    bot['lastDose'] = Date.now();
    let tile = { x: 3508, z: 9497, level: 2 };
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Skills, 'effective').mockReturnValue(77);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Prayer, 'active').mockReturnValue(true);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 70, food: 10, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    spyOn(supply, 'worn').mockReturnValue(true);
    spyOn(supply, 'boostsReady').mockReturnValue(false);
    const boost = spyOn(supply, 'boost').mockResolvedValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'upper', tile }, Date.now());
    party.accept(party.release('upper', 1, Date.now()), Date.now());
    party.receive({ name: 'two', session: 'two', trip: 1, ready: true, stage: 'fight', tile: { x: 3508, z: 9493, level: 0 } }, Date.now());
    spyOn(route, 'ropeReady').mockReturnValue(true);
    const descend = spyOn(route, 'descend').mockImplementation(async () => { tile = { ...tile, z: 9493, level: 0 }; return true; });
    await bot.loop();
    expect(descend).toHaveBeenCalledWith('upper');
    expect(boost).not.toHaveBeenCalled();
    expect<string>(bot.stage).toBe('fight');
});

function releasedGateScene() {
    const { bot } = scene();
    bot.bindLog(() => {});
    bot.stage = 'upper';
    bot.trip = 1;
    bot['prepared'] = true;
    bot['lastDose'] = Date.now();
    const tile = { x: 3508, z: 9497, level: 2 };
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(reader, 'serverTile').mockImplementation(() => tile);
    spyOn(Skills, 'effective').mockReturnValue(70);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 70, food: 10, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    spyOn(supply, 'worn').mockReturnValue(true);
    spyOn(supply, 'boostsReady').mockReturnValue(false);
    const boost = spyOn(supply, 'boost').mockResolvedValue(true);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'upper', tile }, Date.now());
    const release = party.release('upper', 1, Date.now())!;
    spyOn(route, 'ropeReady').mockReturnValue(true);
    spyOn(route, 'step').mockReturnValue(true);
    spyOn(route, 'camelot').mockResolvedValue(false);
    const descend = spyOn(route, 'descend').mockResolvedValue(false);
    return { bot, party, tile, release, boost, descend };
}

test('a release received during one sip enters on the next loop before further boosts', async () => {
    const { bot, party, release, boost, descend } = releasedGateScene();
    let started!: () => void;
    let finished!: () => void;
    const sipStarted = new Promise<void>(resolve => { started = resolve; });
    const sipFinished = new Promise<void>(resolve => { finished = resolve; });
    boost.mockImplementation(async () => { started(); await sipFinished; return true; });
    const firstLoop = bot.loop();
    await sipStarted;
    expect(bot.stage).toBe('travel');
    party.accept(release, Date.now());
    finished();
    await firstLoop;
    expect(descend).not.toHaveBeenCalled();
    await bot.loop();
    expect(descend).toHaveBeenCalledWith('upper');
    expect(boost).toHaveBeenCalledTimes(1);
});

test('a timed-out released descent retries before upkeep and tracks a late arrival once', async () => {
    const { bot, party, tile, release, boost, descend } = releasedGateScene();
    party.accept(release, Date.now());
    await bot.loop();
    expect(bot['descent']).toBe('upper');
    expect(bot.entries).toBe(0);
    await bot.loop();
    expect(descend).toHaveBeenCalledTimes(2);
    expect(boost).not.toHaveBeenCalled();
    expect(bot['descent']).toBe('upper');
    tile.z = 9493;
    tile.level = 0;
    bot['observeDescent']();
    bot['observeDescent']();
    expect(bot['descent']).toBeNull();
    expect(bot.entries).toBe(1);
    expect<string>(bot.stage).toBe('fight');
});

test('low hitpoints do not abort an accepted rope release when food remains', async () => {
    const { bot, party, release, descend } = releasedGateScene();
    party.accept(release, Date.now());
    spyOn(Skills, 'effective').mockReturnValue(31);
    spyOn(supply, 'supplies').mockReturnValue({ hp: 31, food: 10, prayer: 50, prayerDoses: 6, escape: true, arrows: 200 });
    await bot.loop();
    expect(descend).toHaveBeenCalledWith('upper');
    expect(bot.stage).toBe('upper');
    expect(bot['descent']).toBe('upper');
});

test('an aborted release cannot enter after the peer advertises readiness again', async () => {
    const { bot, party, tile, release, descend } = releasedGateScene();
    party.accept(release, Date.now());
    party.receive({ name: 'two', session: 'two', trip: 1, ready: false, stage: 'retreat', tile }, Date.now());
    party.receive({ name: 'two', session: 'two', trip: 1, ready: true, stage: 'upper', tile }, Date.now());
    await bot.loop();
    expect(descend).not.toHaveBeenCalled();
    expect(bot.stage).toBe('retreat');
    expect(bot['descent']).toBeNull();
});
