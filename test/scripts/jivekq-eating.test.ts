import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '../../src/bot/adapter/ClientAdapter.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Inventory, InvItem } from '../../src/bot/api/inventory/Inventory.js';
import { Execution } from '../../src/bot/api/execution/Execution.js';
import { Prayer, PROTECT_FROM_MAGIC } from '../../src/bot/api/prayer/Prayer.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { Special } from '../../src/bot/api/combat/Special.js';
import { Input } from '../../src/bot/input/Input.js';
import { Reachability } from '../../src/bot/event/webwalk/geometry/Reachability.js';
import JiveKQ from '../../src/bot/scripts/JiveKQ/JiveKQ.js';
import { Party } from '../../src/bot/scripts/JiveKQ/party.js';
import * as supply from '../../src/bot/scripts/JiveKQ/supply.js';
import * as route from '../../src/bot/scripts/JiveKQ/route.js';

afterEach(() => mock.restore());

function combat() {
    const state = { tick: 100, hp: 45, food: 10, accept: true };
    const events: { action: string; tick: number }[] = [];
    const bot = new JiveKQ();
    bot.stage = 'fight'; bot.trip = 1; bot['prepared'] = true; bot['lastDose'] = Date.now(); bot['lastAttack'] = state.tick;
    bot.bindLog(() => {});
    const tile = { x: 3477, z: 9493, level: 0 };
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, ready: true, stage: 'fight', tile }, Date.now());
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'tick').mockImplementation(() => state.tick);
    spyOn(Game, 'combatMode').mockReturnValue(1);
    spyOn(Game, 'combatStyles').mockReturnValue([{ mode: 1, label: 'Aggressive' }]);
    spyOn(reader, 'selfFaceEntity').mockReturnValue(1);
    spyOn(reader, 'npcs').mockReturnValue([{
        index: 1, id: 1158, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3480, z: 9493, level: 0 }, distance: 3, ops: ['Attack'],
        inCombat: true, health: 255, totalHealth: 255, faceEntity: -1
    }]);
    spyOn(Skills, 'effective').mockImplementation(skill => skill === 'hitpoints' ? state.hp : 80);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Inventory, 'countById').mockImplementation(id => id === supply.FOOD ? state.food : 0);
    spyOn(Prayer, 'points').mockReturnValue(60);
    spyOn(Prayer, 'active').mockReturnValue(true);
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(Special, 'ready').mockReturnValue(false);
    spyOn(supply, 'supplies').mockImplementation(() => ({ hp: state.hp, food: state.food, prayer: 60, prayerDoses: 6, escape: true, arrows: 200 }));
    spyOn(supply, 'worn').mockReturnValue(true);
    spyOn(supply, 'boost').mockResolvedValue(false);
    const eat = spyOn(supply, 'eat').mockImplementation(async (confirm = true) => {
        events.push({ action: 'eat', tick: state.tick });
        if (confirm) state.tick++;
        return state.accept;
    });
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(Input, 'interactNpc').mockImplementation(() => { events.push({ action: 'attack', tick: state.tick }); return true; });
    return { bot, state, events, eat };
}

test('food and a renewed attack are submitted in the same tick even when already facing the queen', async () => {
    const { bot, events } = combat();
    await bot.loop();
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'attack', tick: 100 }]);
});

test('critical HP eats and continues the fight without a personal or group retreat', async () => {
    const { bot, state, events } = combat();
    state.hp = 15;
    await bot.loop();
    expect(bot.stage).toBe('fight');
    expect(bot.retreats).toBe(0);
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'attack', tick: 100 }]);
});

test('a late phase weapon equip keeps eating available without retreating or sending another equip', async () => {
    const { bot, state, events } = combat();
    let equipped = false;
    spyOn(supply, 'worn').mockImplementation(id => id !== supply.MACE || equipped);
    spyOn(Inventory, 'countById').mockImplementation(id => id === supply.FOOD ? state.food : id === supply.MACE ? 1 : 0);
    let respond!: (ok: boolean) => void;
    const equip = spyOn(supply, 'equip').mockImplementation(() => new Promise(resolve => { respond = resolve; }));
    let finished = false;
    const first = bot.loop().then(() => { finished = true; });
    await Bun.sleep(10);
    const completedWhilePending = finished;
    if (finished) {
        state.tick = 101; state.food--; bot['observeFood'](); state.tick = 103;
        await bot.loop();
    }
    respond(false);
    await first;
    state.tick = 104; state.hp = 70;
    await bot.loop();
    equipped = true; state.tick = 108;
    await bot.loop();
    expect(completedWhilePending).toBe(true);
    expect(equip).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'eat', tick: 103 }, { action: 'attack', tick: 108 }]);
    expect(bot.stage).toBe('fight');
    expect(bot.retreats).toBe(0);
});

test('a missing phase weapon restocks only its owner', async () => {
    const { bot, state } = combat();
    state.hp = 70;
    spyOn(supply, 'worn').mockImplementation(id => id !== supply.MACE);
    spyOn(supply, 'equip').mockResolvedValue(false);
    await bot.loop();
    expect(bot.stage).toBe('retreat');
    expect(bot.restocking).toBe(true);
    expect(bot['party']!.unsafe(1, Date.now())).toBe(false);
});

test('a rejected equip retries after its grace period while the weapon remains available', async () => {
    const { bot, state } = combat();
    state.hp = 70;
    spyOn(supply, 'worn').mockImplementation(id => id !== supply.MACE);
    spyOn(Inventory, 'countById').mockImplementation(id => id === supply.FOOD ? state.food : id === supply.MACE ? 1 : 0);
    const equip = spyOn(supply, 'equip').mockRejectedValue(new Error('input rejected'));
    await bot.loop();
    state.tick = 109; await bot.loop();
    expect(equip).toHaveBeenCalledTimes(1);
    state.tick = 110; await bot.loop();
    expect(equip).toHaveBeenCalledTimes(2);
    expect(bot.stage).toBe('fight');
    expect(bot.status).toBe('equipping dragon mace');
    expect(bot.retreats).toBe(0);
});

test('a phase change waits for an earlier equip before switching back', async () => {
    const { bot, state } = combat();
    let weapon = supply.MACE;
    spyOn(supply, 'worn').mockImplementation(id => id === weapon);
    spyOn(Inventory, 'countById').mockImplementation(id => id === weapon ? 0 : 1);
    const equip = spyOn(supply, 'equip').mockResolvedValue(false);
    expect(bot['equipWeapon'](supply.BOW)).toBe(false);
    await Promise.resolve();
    state.tick = 104;
    expect(bot['equipWeapon'](supply.MACE)).toBe(false);
    expect(equip).toHaveBeenCalledTimes(1);
    weapon = supply.BOW; state.tick = 108;
    expect(bot['equipWeapon'](supply.MACE)).toBe(false);
    expect(equip.mock.calls).toEqual([[supply.BOW], [supply.MACE]]);
    await Promise.resolve();
    weapon = supply.MACE; state.tick = 109;
    expect(bot['equipWeapon'](supply.MACE)).toBe(true);
    expect(bot.retreats).toBe(0);
});

test('pending offensive prayers do not block eating or attacks, and failures do not retreat', async () => {
    const { bot, state, events } = combat();
    spyOn(Prayer, 'active').mockImplementation(name => name === PROTECT_FROM_MAGIC);
    const responses: ((ok: boolean) => void)[] = [];
    const prayer = spyOn(Prayer, 'set').mockImplementation(name => name === PROTECT_FROM_MAGIC ? Promise.resolve(true) : new Promise(resolve => responses.push(resolve)));
    let finished = false;
    const first = bot.loop().then(() => { finished = true; });
    await Bun.sleep(10);
    const completedWhilePending = finished;
    if (finished) {
        state.tick = 101; state.food--; bot['observeFood'](); state.tick = 103;
        await bot.loop();
    }
    responses.forEach(resolve => resolve(false));
    await first;
    expect(completedWhilePending).toBe(true);
    expect(prayer.mock.calls.filter(([name]) => name !== PROTECT_FROM_MAGIC)).toHaveLength(2);
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'attack', tick: 100 }, { action: 'eat', tick: 103 }, { action: 'attack', tick: 103 }]);
    expect(bot.stage).toBe('fight');
    expect(bot.retreats).toBe(0);
});

test('pending protection keeps eating available without attacking unprotected', async () => {
    const { bot, state, events } = combat();
    spyOn(Prayer, 'active').mockReturnValue(false);
    let respond!: (ok: boolean) => void;
    const prayer = spyOn(Prayer, 'set').mockImplementation(() => new Promise(resolve => { respond = resolve; }));
    let finished = false;
    const first = bot.loop().then(() => { finished = true; });
    await Bun.sleep(10);
    const completedWhilePending = finished;
    if (finished) {
        state.tick = 101; state.food--; bot['observeFood'](); state.tick = 103;
        await bot.loop();
    }
    respond(false);
    await first;
    expect(completedWhilePending).toBe(true);
    expect(prayer).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'eat', tick: 103 }]);
    expect(bot.stage).toBe('fight');
});

test('repeated protection failures restock only the affected player', async () => {
    const { bot, state } = combat();
    state.hp = 70;
    spyOn(Prayer, 'active').mockReturnValue(false);
    spyOn(Prayer, 'set').mockResolvedValue(false);
    spyOn(route, 'step').mockReturnValue(true);
    await bot.loop();
    expect(bot.stage).toBe('fight');
    state.tick += 10;
    await bot.loop();
    expect(bot.stage).toBe('fight');
    state.tick += 10;
    await bot.loop();
    expect(bot.stage).toBe('retreat');
    expect(bot.restocking).toBe(true);
    expect(bot['party']!.unsafe(1, Date.now())).toBe(false);
});

test('late protection confirmation is observed before another toggle is sent', async () => {
    const { bot, state, events } = combat();
    state.hp = 70;
    let protectedFromMagic = false;
    spyOn(Prayer, 'active').mockImplementation(name => name === PROTECT_FROM_MAGIC ? protectedFromMagic : true);
    const prayer = spyOn(Prayer, 'set').mockResolvedValue(false);
    await bot.loop();
    for (state.tick = 101; state.tick < 108; state.tick++) await bot.loop();
    expect(prayer).toHaveBeenCalledTimes(1);
    protectedFromMagic = true;
    state.tick = 108;
    await bot.loop();
    expect(prayer).toHaveBeenCalledTimes(1);
    expect(events).toEqual([{ action: 'attack', tick: 108 }]);
    expect(bot.stage).toBe('fight');
    expect(bot.retreats).toBe(0);
});

test('a delayed second protection acknowledgement does not trigger a premature personal retreat', async () => {
    const { bot, state } = combat();
    state.hp = 70;
    let protectedFromMagic = false;
    spyOn(Prayer, 'active').mockImplementation(name => name === PROTECT_FROM_MAGIC ? protectedFromMagic : true);
    const prayer = spyOn(Prayer, 'set').mockResolvedValue(false);
    await bot.loop();
    state.tick = 110; await bot.loop();
    for (state.tick = 111; state.tick < 118; state.tick++) await bot.loop();
    expect(bot.stage).toBe('fight');
    protectedFromMagic = true;
    state.tick = 118; await bot.loop();
    expect(prayer).toHaveBeenCalledTimes(2);
    expect(bot.stage).toBe('fight');
    expect(bot.retreats).toBe(0);
});

test('clearing prayers keeps food available and does not repeat a delayed off toggle', async () => {
    const { bot, state, events } = combat();
    bot['queenTracker'].killedAt = 1;
    spyOn(reader, 'npcs').mockReturnValue([]);
    let protectedFromMagic = true;
    spyOn(Prayer, 'active').mockImplementation(name => name === PROTECT_FROM_MAGIC && protectedFromMagic);
    const prayer = spyOn(Prayer, 'set').mockResolvedValue(false);
    await bot['upkeep']();
    state.tick = 101; state.food--; bot['observeFood']();
    state.tick = 103; await bot['upkeep']();
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'eat', tick: 103 }]);
    expect(prayer.mock.calls).toEqual([[PROTECT_FROM_MAGIC, false]]);
    state.tick = 108; protectedFromMagic = false;
    expect(bot['clearPrayers']()).toBe(true);
    expect(prayer).toHaveBeenCalledTimes(1);
});

test('a food-reserve retreat preserves the last combat eat cooldown before healing and teleporting', async () => {
    const { bot, state, eat } = combat();
    state.hp = 26; state.food = 2;
    await bot.loop();
    state.tick++; state.hp = 46; state.food = 1; bot.stage = 'retreat';
    const teleport = spyOn(route, 'camelot').mockResolvedValue(false);
    await bot['escape']();
    state.tick++;
    await bot['escape']();
    expect(eat).toHaveBeenCalledTimes(1);
    expect(teleport).not.toHaveBeenCalled();
    state.tick++;
    eat.mockImplementation(async () => { state.food--; state.hp += 20; return true; });
    await bot['escape']();
    expect(state.hp).toBe(66);
    expect(eat).toHaveBeenCalledTimes(2);
    expect(teleport).toHaveBeenCalledTimes(1);
});

test('confirmed food respects the three-tick cooldown while attack input remains available', async () => {
    const { bot, state, events, eat } = combat();
    await bot.loop();
    state.tick++; state.food--;
    spyOn(reader, 'selfFaceEntity').mockReturnValue(-1);
    await bot.loop();
    state.tick++; await bot.loop();
    expect(eat).toHaveBeenCalledTimes(1);
    expect(events.filter(e => e.action === 'attack').map(e => e.tick)).toEqual([100, 101, 102]);
    state.tick++; await bot.loop();
    expect(eat).toHaveBeenCalledTimes(2);
    expect(events.slice(-2)).toEqual([{ action: 'eat', tick: 103 }, { action: 'attack', tick: 103 }]);
});

test('an unconfirmed food request retries after four ticks without stopping combat', async () => {
    const { bot, state, eat } = combat();
    await bot.loop();
    for (state.tick = 101; state.tick < 104; state.tick++) await bot.loop();
    expect(eat).toHaveBeenCalledTimes(1);
    await bot.loop();
    expect(eat).toHaveBeenCalledTimes(2);
    expect(bot.stage).toBe('fight');
});

test('late food confirmation delays the next eat without repeating the pending action', async () => {
    const { bot, state, eat } = combat();
    await bot.loop();
    state.tick = 103; state.food--; await bot.loop();
    state.tick = 104; await bot.loop();
    expect(eat).toHaveBeenCalledTimes(1);
    state.tick = 105; await bot.loop();
    expect(eat).toHaveBeenCalledTimes(2);
});

test('food consumed while another action awaits does not gain an extra cooldown on loop resumption', async () => {
    const { bot, state, eat } = combat();
    await bot.loop();
    state.tick = 101; state.food--; bot['observeFood']();
    state.tick = 104; await bot.loop();
    expect(eat).toHaveBeenCalledTimes(2);
});

test('critical HP sends food before waiting for prayer protection', async () => {
    const { bot, state, events } = combat();
    state.hp = 20;
    spyOn(Prayer, 'active').mockReturnValue(false);
    const prayer = spyOn(Prayer, 'set').mockResolvedValue(true);
    await bot['upkeep']();
    expect(events).toEqual([{ action: 'eat', tick: 100 }]);
    expect(prayer).not.toHaveBeenCalled();
});

test('nonblocking food sends the real inventory input without awaiting confirmation', async () => {
    const shark = new InvItem({ slot: 10, id: 385, name: 'Shark', count: 1, ops: ['Eat'], comId: 3214 });
    spyOn(Inventory, 'items').mockReturnValue([shark]);
    spyOn(Inventory, 'countById').mockReturnValue(10);
    const input = spyOn(Input, 'heldOp').mockReturnValue(true);
    const wait = spyOn(Execution, 'delayUntilTicks').mockResolvedValue(false);
    expect(await supply.eat(false)).toBe(true);
    expect(input).toHaveBeenCalledWith(385, 10, 3214, 1);
    expect(wait).not.toHaveBeenCalled();
    expect(await supply.eat()).toBe(false);
    expect(wait).toHaveBeenCalledTimes(1);
});

test('rejected food input can retry next tick', async () => {
    const { bot, state, eat } = combat();
    state.accept = false; await bot.loop();
    state.tick++; state.accept = true; await bot.loop();
    expect(eat).toHaveBeenCalledTimes(2);
});

test('empty prayer restores before routine food without retreating', async () => {
    const { bot, events, eat } = combat();
    spyOn(Prayer, 'points').mockReturnValue(0);
    spyOn(Prayer, 'active').mockReturnValue(false);
    spyOn(Prayer, 'set').mockResolvedValue(false);
    spyOn(supply, 'doses').mockReturnValue(4);
    spyOn(supply, 'drink').mockImplementation(async () => { events.push({ action: 'restore', tick: 100 }); return true; });
    await bot.loop();
    expect(eat).not.toHaveBeenCalled();
    expect(events).toEqual([{ action: 'restore', tick: 100 }]);
    expect(bot.stage).toBe('fight');
});

test('critical HP eats first at zero prayer and waits for restore without retreating', async () => {
    const { bot, state, events } = combat();
    state.hp = 20;
    spyOn(Prayer, 'points').mockReturnValue(0);
    spyOn(Prayer, 'active').mockReturnValue(false);
    spyOn(Prayer, 'set').mockResolvedValue(false);
    spyOn(supply, 'doses').mockReturnValue(4);
    const drink = spyOn(supply, 'drink').mockImplementation(async () => { events.push({ action: 'restore', tick: state.tick }); return true; });
    await bot.loop();
    expect(events).toEqual([{ action: 'eat', tick: 100 }]);
    state.tick++; state.food--; state.hp = 40; await bot.loop();
    expect(drink).not.toHaveBeenCalled();
    expect(bot.stage).toBe('fight');
    state.tick = 103; await bot.loop();
    expect(events.at(-1)).toEqual({ action: 'restore', tick: 103 });
});

test('offensive prayer and special acknowledgements do not delay the eat and attack inputs', async () => {
    const { bot, events } = combat();
    let finish!: () => void;
    const confirmation = new Promise<void>(resolve => { finish = resolve; });
    spyOn(Prayer, 'set').mockImplementation(async name => { if (name !== 'Protect from Magic') await confirmation; return true; });
    spyOn(Special, 'ready').mockReturnValue(true);
    spyOn(Special, 'arm').mockImplementation(async () => { await confirmation; return true; });
    const loop = bot.loop();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(events).toEqual([{ action: 'eat', tick: 100 }, { action: 'attack', tick: 100 }]);
    finish(); await loop;
});
