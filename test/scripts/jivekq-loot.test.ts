import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type GroundItemSnapshot, type InvItemSnapshot } from '../../src/bot/adapter/ClientAdapter.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Prayer, PROTECT_FROM_MAGIC } from '../../src/bot/api/prayer/Prayer.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { Special } from '../../src/bot/api/combat/Special.js';
import { ChatDialog } from '../../src/bot/api/ui/dialogue/ChatDialog.js';
import { Input } from '../../src/bot/input/Input.js';
import { Reachability } from '../../src/bot/event/webwalk/geometry/Reachability.js';
import JiveKQ from '../../src/bot/scripts/JiveKQ/JiveKQ.js';
import { Party } from '../../src/bot/scripts/JiveKQ/party.js';
import * as supply from '../../src/bot/scripts/JiveKQ/supply.js';

const tile = { x: 3477, z: 9493, level: 0 };
const names = ['one', 'two', 'three', 'four'];
const drop = (id = 1113, name = 'Rune chainbody', x = 3500): GroundItemSnapshot => ({ id, name, count: 1, tile: { ...tile, x }, distance: Math.abs(x - tile.x), ops: [null, null, 'Take'] });
const item = (id: number, name: string, slot = 0): InvItemSnapshot => ({ id, name, slot, count: 1, comId: 3214, ops: ['Eat', null, null, null, 'Drop'] });
afterEach(() => mock.restore());

function scene() {
    const state = { tick: 100, hp: 70, tile: { ...tile }, drops: [drop()], pack: Array.from({ length: 10 }, (_, i) => item(385, 'Shark', i)), active: new Set([PROTECT_FROM_MAGIC]), accept: true };
    const actions: { kind: string; id?: number; tick: number }[] = [];
    const bot = new JiveKQ();
    bot.bindLog(() => {});
    bot.stage = 'fight'; bot.trip = 1; bot['prepared'] = true; bot['lastDose'] = 100_000;
    const party = new Party(names, 'one', 'one');
    bot['party'] = party;
    const heartbeat = () => names.forEach(name => party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile: state.tile }, 100_000 + state.tick * 600));
    heartbeat();
    spyOn(Date, 'now').mockImplementation(() => 100_000 + state.tick * 600);
    spyOn(Game, 'tick').mockImplementation(() => state.tick);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'combatMode').mockReturnValue(1);
    spyOn(Game, 'combatStyles').mockReturnValue([{ mode: 1, label: 'Aggressive' }]);
    spyOn(reader, 'serverTile').mockImplementation(() => state.tile);
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x - 3456, lz: z - 9472 }));
    spyOn(reader, 'groundItems').mockImplementation(() => state.drops);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'objCatalog').mockReturnValue([{ id: 565, name: 'Blood rune', stackable: true, cost: 1, members: true, equippable: false, certlink: -1, certtemplate: -1 }]);
    spyOn(reader, 'npcs').mockReturnValue([{
        index: 1, id: 1158, anim: -1, name: 'Kalphite Queen', level: 333, size: 5,
        tile: { x: 3480, z: 9493, level: 0 }, distance: 3, ops: ['Attack'],
        inCombat: true, health: 255, totalHealth: 255, faceEntity: -1
    }]);
    spyOn(Prayer, 'points').mockReturnValue(60);
    spyOn(Prayer, 'active').mockImplementation(name => state.active.has(name));
    spyOn(Prayer, 'set').mockImplementation(async (name, on) => { if (on) state.active.add(name); else state.active.delete(name); return true; });
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Skills, 'effective').mockImplementation(skill => skill === 'hitpoints' ? state.hp : 80);
    spyOn(supply, 'supplies').mockImplementation(() => ({ hp: state.hp, food: state.pack.filter(i => i.id === 385).length, prayer: 60, prayerDoses: 6, escape: true, arrows: 200 }));
    spyOn(supply, 'worn').mockReturnValue(true);
    spyOn(supply, 'boost').mockResolvedValue(false);
    spyOn(supply, 'eat').mockImplementation(async () => { actions.push({ kind: 'eat', tick: state.tick }); return true; });
    spyOn(Special, 'ready').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Reachability, 'walkable').mockReturnValue(true);
    spyOn(Reachability, 'lineOfSight').mockReturnValue(true);
    spyOn(Input, 'takeObj').mockImplementation((_x, _z, id) => { actions.push({ kind: 'take', id, tick: state.tick }); return state.accept; });
    spyOn(Input, 'heldOp').mockImplementation((id) => { actions.push({ kind: 'drop', id, tick: state.tick }); return state.accept; });
    spyOn(Input, 'interactNpc').mockImplementation(() => { actions.push({ kind: 'attack', tick: state.tick }); return true; });
    spyOn(Input, 'walk').mockImplementation(() => { actions.push({ kind: 'walk', tick: state.tick }); return true; });
    const next = async (ticks = 1) => {
        state.tick += ticks;
        for (const name of names.slice(1)) party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile: state.tile, ...party.members(Date.now() - ticks * 600).find(m => m.name === name) }, Date.now());
        bot['heartbeat']();
        await bot.loop();
    };
    return { bot, party, state, actions, next };
}

test('late public valuable loot across the visible chamber is collected during a living queen fight', async () => {
    const { bot, state, actions, next } = scene();
    bot.kills = 0;
    await bot.loop();
    expect(actions.filter(a => a.kind === 'take')).toEqual([]);
    await next();
    expect(actions.filter(a => a.kind === 'take')).toEqual([{ kind: 'take', id: 1113, tick: 101 }]);
    expect(bot.looted).toBe(0);
    state.pack.push(item(1113, 'Rune chainbody', 10));
    await next();
    expect(bot.looted).toBe(1);
    expect(bot.stage).toBe('fight');
    expect(state.active.has(PROTECT_FROM_MAGIC)).toBe(true);
});

test('arrow drops never interrupt combat or win over valuable equipment', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(892, 'Rune arrow', 3477), drop(884, 'Iron arrow', 3477), drop(888, 'Mithril arrow', 3477), drop(1731, 'Amulet of power', 3495)];
    await bot.loop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1731]);
});

test('a far accepted pickup survives more than four movement ticks without blocking food', async () => {
    const { bot, state, actions, next } = scene();
    await bot.loop(); await next();
    for (let i = 0; i < 6; i++) { state.tile.x++; await next(); }
    state.hp = 20;
    await next();
    expect(actions.filter(a => a.kind === 'eat')).toEqual([{ kind: 'eat', tick: 108 }]);
    expect(actions.filter(a => a.kind === 'take').length).toBeGreaterThan(0);
    state.pack.push(item(1113, 'Rune chainbody', 10)); state.drops = [];
    await next();
    expect(bot.looted).toBe(1);
    expect(bot.retreats).toBe(0);
});

test('another team taking a target releases it after grace without inventing a pickup', async () => {
    const { bot, state, actions, next } = scene();
    await bot.loop(); await next(); state.drops = [];
    await next(); await next(4);
    expect(bot.looted).toBe(0);
    expect(actions.at(-1)?.kind).toBe('attack');
    expect(bot.retreats).toBe(0);
});

test('a full pack drops a vial once and waits for room before taking the target', async () => {
    const { bot, state, actions, next } = scene();
    state.pack = [item(229, 'Vial'), ...Array.from({ length: 27 }, (_, i) => item(385, 'Shark', i + 1))];
    await bot.loop(); await next(); await next();
    expect(actions.filter(a => a.kind === 'drop').map(a => a.id)).toEqual([229]);
    expect(actions.filter(a => a.kind === 'take')).toEqual([]);
    state.pack.shift(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1113]);
});

test('a healthy full pack eats one shark for equipment and waits for its slot', async () => {
    const { bot, state, actions, next } = scene();
    state.pack = Array.from({ length: 28 }, (_, i) => item(385, 'Shark', i));
    await bot.loop(); await next(); await next(); await next();
    expect(actions.filter(a => a.kind === 'eat')).toEqual([{ kind: 'eat', tick: 101 }]);
    expect(actions.some(a => a.kind === 'drop' || a.kind === 'take')).toBe(false);
    state.pack.pop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1113]);
});

test('damage during a pending room-making Eat shares healing confirmation and cooldown', async () => {
    const { bot, state, actions, next } = scene();
    state.pack = Array.from({ length: 28 }, (_, i) => item(385, 'Shark', i));
    await bot.loop(); await next();
    state.hp = 30; await next();
    expect(actions.filter(a => a.kind === 'eat')).toEqual([{ kind: 'eat', tick: 101 }]);
    state.pack.pop(); state.hp = 50; await next();
    expect(actions.filter(a => a.kind === 'take')).toEqual([{ kind: 'take', id: 1113, tick: 103 }]);
    state.hp = 20; await next();
    expect(actions.filter(a => a.kind === 'eat')).toHaveLength(1);
    await next();
    expect(actions.filter(a => a.kind === 'eat').map(a => a.tick)).toEqual([101, 105]);
    expect(actions.some(a => a.kind === 'drop')).toBe(false);
});

test('room-making food waits for the existing cooldown and retries without abandoning gear', async () => {
    const { bot, state, actions, next } = scene();
    state.pack = Array.from({ length: 28 }, (_, i) => item(385, 'Shark', i));
    bot['nextEatTick'] = 103;
    await bot.loop(); await next(); await next();
    expect(actions.some(a => a.kind === 'eat' || a.kind === 'drop')).toBe(false);
    await next();
    expect(actions.filter(a => a.kind === 'eat')).toEqual([{ kind: 'eat', tick: 103 }]);
    state.pack.pop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1113]);
});

test('healthy unacknowledged room food retries after bounded backoff without requiring damage', async () => {
    const { bot, state, actions, next } = scene();
    state.pack = Array.from({ length: 28 }, (_, i) => item(385, 'Shark', i));
    await bot.loop();
    for (let i = 0; i < 28; i++) await next();
    expect(actions.filter(a => a.kind === 'eat').map(a => a.tick)).toEqual([101, 128]);
    expect(actions.some(a => a.kind === 'attack' && a.tick > 107 && a.tick < 127)).toBe(true);
    expect(actions.some(a => a.kind === 'drop' || a.kind === 'take')).toBe(false);
    expect(state.hp).toBe(70);
    expect(bot.retreats).toBe(0);
});

test('pending combat food prevents a room-making Drop until the Eat frees its slot', async () => {
    const { bot, state, actions, next } = scene();
    state.pack = Array.from({ length: 28 }, (_, i) => item(385, 'Shark', i));
    await bot.loop();
    state.hp = 30;
    await next(); await next();
    expect(actions.filter(a => a.kind === 'eat')).toEqual([{ kind: 'eat', tick: 101 }]);
    expect(actions.some(a => a.kind === 'drop' || a.kind === 'take')).toBe(false);
    state.pack.pop(); state.hp = 50;
    await next();
    expect(actions.some(a => a.kind === 'drop')).toBe(false);
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1113]);
});

test('pending combat food still allows a pickup into an existing stack', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(565, 'Blood rune')];
    state.pack = [item(565, 'Blood rune'), ...Array.from({ length: 27 }, (_, i) => item(385, 'Shark', i + 1))];
    await bot.loop();
    state.hp = 30;
    await next();
    expect(actions.some(a => a.kind === 'eat')).toBe(true);
    expect(actions.some(a => a.kind === 'drop')).toBe(false);
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([565]);
});

test('full inventory never drops escape supplies or sacrifices food for consumable loot', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(565, 'Blood rune')];
    state.pack = [item(556, 'Air rune'), item(563, 'Law rune'), ...Array.from({ length: 26 }, (_, i) => item(385, 'Shark', i + 2))];
    await bot.loop(); await next();
    expect(actions.some(a => a.kind === 'drop' || a.kind === 'take')).toBe(false);
    expect(actions.some(a => a.kind === 'attack')).toBe(true);
});

test('a teammate death pile is excluded from ordinary queen loot', async () => {
    const { bot, party, state, actions, next } = scene();
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'bank', restocking: true, ready: true, tile: state.tile, death: { at: Date.now(), tile: state.drops[0].tile, items: [{ id: 1113, count: 1 }], ground: [] } }, Date.now());
    bot['recoverLoot'] = async () => false;
    await bot.loop(); await next();
    expect(actions.some(a => a.kind === 'take')).toBe(false);
});

test('arrow-only ground leaves normal attacks unchanged', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(892, 'Rune arrow', 3477)];
    await bot.loop(); await next(4);
    expect(actions.map(a => a.kind)).toEqual(['attack', 'attack']);
});

test('a private drop can elect the later roster member who can actually see it', async () => {
    const { bot, state, actions, next } = scene();
    const party = new Party(names, 'three', 'three');
    bot['party'] = party;
    for (const name of names) party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile: state.tile }, Date.now());
    await bot.loop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1113]);
    expect(party.lootCollector(1, Date.now())?.name).toBe('three');
});

test('simultaneous candidates keep a second fighter on combat while one collector takes', async () => {
    const { bot, party, state, actions, next } = scene();
    const claim = { id: 1113, name: 'Rune chainbody', tile: state.drops[0].tile, collecting: false };
    await bot.loop();
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'fight', ready: true, tile: state.tile, loot: claim }, Date.now());
    await next();
    expect(party.lootCollector(1, Date.now())?.name).toBe('one');
    expect(actions.filter(a => a.kind === 'take').length).toBe(1);
    const follower = new JiveKQ();
    follower.bindLog(() => {}); follower.stage = 'fight'; follower.trip = 1;
    const peers = new Party(names, 'two', 'two');
    for (const member of party.members(Date.now())) peers.receive(member, Date.now());
    follower['party'] = peers;
    follower['loot'](); state.tick++; follower['loot']();
    expect(actions.filter(a => a.kind === 'take').length).toBe(1);
    expect(follower['collector'].claim?.collecting).toBe(false);
});

test('an unacknowledged pickup backs off and lets ordinary combat resume', async () => {
    const { bot, state, actions, next } = scene();
    state.accept = false;
    await bot.loop();
    for (let i = 0; i < 24; i++) await next();
    const attempts = actions.filter(a => a.kind === 'take').length;
    expect(attempts).toBeGreaterThan(0);
    expect(attempts).toBeLessThanOrEqual(4);
    expect(actions.slice(-3).some(a => a.kind === 'attack')).toBe(true);
    expect(bot['collector'].claim).toBeNull();
    expect(bot.retreats).toBe(0);
    expect(bot.looted).toBe(0);
});

test('a full inventory can collect an existing rune stack without dropping a supply', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(565, 'Blood rune')];
    state.pack = [item(565, 'Blood rune'), ...Array.from({ length: 27 }, (_, i) => item(385, 'Shark', i + 1))];
    await bot.loop(); await next();
    expect(actions.filter(a => a.kind === 'drop')).toEqual([]);
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([565]);
    state.pack[0].count += 100; await next();
    expect(bot['lootCounts'].get('Blood rune')).toBe(100);
});

test('valuable equipment outranks a nearer consumable drop', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(565, 'Blood rune', 3477), drop(3140, 'Dragon chainbody', 3505)];
    await bot.loop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([3140]);
});

test('between kills loot collection keeps every prayer off', async () => {
    const { bot, state, actions, next } = scene();
    bot['queenTracker'].killedAt = Date.now(); bot['lastKillTick'] = state.tick;
    spyOn(reader, 'npcs').mockReturnValue([]);
    state.active.add('Ultimate strength'); state.active.add('Incredible reflexes');
    await bot.loop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([1113]);
    expect([...state.active]).toEqual([]);
});

test('a late inventory update still confirms a vanished pickup without another take', async () => {
    const { bot, state, actions, next } = scene();
    await bot.loop(); await next(); state.drops = [];
    await next();
    expect(bot.looted).toBe(0);
    state.pack.push(item(1113, 'Rune chainbody', 10)); await next();
    expect(bot.looted).toBe(1);
    expect(actions.filter(a => a.kind === 'take').length).toBe(1);
});

test('a retreat clears the collecting claim immediately', async () => {
    const { bot, party, actions, next } = scene();
    await bot.loop(); await next();
    expect(actions.some(a => a.kind === 'take')).toBe(true);
    bot.requestRetreat('test retreat');
    expect(bot['collector'].claim).toBeNull();
    expect(party.members(Date.now()).find(m => m.name === 'one')?.loot).toBeUndefined();
});

test('a full pack with two sharks preserves the reserve even for gear', async () => {
    const { bot, state, actions } = scene();
    state.pack = [item(385, 'Shark'), item(385, 'Shark', 1), ...Array.from({ length: 26 }, (_, i) => item(563, 'Law rune', i + 2))];
    bot['loot'](); state.tick++; bot['loot']();
    expect(actions.some(a => a.kind === 'drop' || a.kind === 'take' || a.kind === 'eat')).toBe(false);
});

test('an unknown respawn health bar keeps magic protection while collecting', async () => {
    const { bot, state, actions, next } = scene();
    bot['queenTracker'].killedAt = Date.now(); bot['lastKillTick'] = state.tick;
    spyOn(reader, 'npcs').mockReturnValue(reader.npcs().map(n => ({ ...n, health: 0, totalHealth: 0 })));
    await bot.loop(); await next();
    expect(actions.some(a => a.kind === 'take')).toBe(true);
    expect(state.active.has(PROTECT_FROM_MAGIC)).toBe(true);
});

test('failed protection during collection preserves the retreat reason and sends no pickup', () => {
    const { bot, state, actions } = scene();
    bot['loot'](); state.tick++;
    state.active.clear(); bot['protectionFailures'] = 2;
    bot['prayerRequests'].set(PROTECT_FROM_MAGIC, { on: true, pending: false, retryTick: 100 });
    bot['loot']();
    expect(bot.stage).toBe('retreat');
    expect(bot.status).toBe('could not restore magic protection after retrying');
    expect(actions.some(a => a.kind === 'take')).toBe(false);
});

test('a noted non-rune stack fits a full inventory using the actual item metadata', async () => {
    const { bot, state, actions, next } = scene();
    state.drops = [drop(246, 'Wine of zamorak')];
    state.pack = [item(246, 'Wine of zamorak'), ...Array.from({ length: 27 }, (_, i) => item(385, 'Shark', i + 1))];
    spyOn(reader, 'objCatalog').mockReturnValue([{ id: 246, name: 'Wine of zamorak', stackable: true, cost: 1, members: true, equippable: false, certlink: 245, certtemplate: 799 }]);
    await bot.loop(); await next();
    expect(actions.filter(a => a.kind === 'take').map(a => a.id)).toEqual([246]);
    expect(actions.some(a => a.kind === 'drop')).toBe(false);
});

test('loot waits until every active member has finished chamber entry', async () => {
    const { bot, party, actions, next } = scene();
    bot['entryAt'] = Date.now();
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'upper', ready: true, tile: { x: 3508, z: 9497, level: 2 } }, Date.now());
    await bot.loop(); await next();
    expect(actions.some(a => a.kind === 'take')).toBe(false);
    expect(bot['collector'].claim).toBeNull();
    expect(bot.status).toBe('waiting for the team to finish descending');
});

test('a quick pickup renews combat immediately despite a still-current queen face target', async () => {
    const { bot, state, actions, next } = scene();
    spyOn(reader, 'selfFaceEntity').mockReturnValue(1);
    await bot.loop(); await next();
    state.pack.push(item(1113, 'Rune chainbody', 10)); state.drops = [];
    await next();
    expect(actions.filter(a => a.kind === 'attack').map(a => a.tick)).toEqual([100, 102]);
});
