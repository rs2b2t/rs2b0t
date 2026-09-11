import { afterEach, expect, spyOn, test } from 'bun:test';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import * as supply from '#/bot/scripts/JiveDragons/supply.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

test('accepted attack owns the live loot hold without self combat', async () => {
    const { bot, state, engage } = await scenario();
    await engage();
    await bot.loop();
    expect(state.takes).toBe(0);
    expect(state.drops).toBe(0);
    expect(bot.killsTotal).toBe(0);
});

test('refused attack never owns a disappearance or blocks old arrows', async () => {
    const { bot, state, engage } = await scenario();
    spyOn(Npc.prototype, 'interact').mockReturnValue(false);
    await engage();
    state.npcs = [];
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(bot.killsTotal).toBe(0);
});

test('takeover abandons kill credit but holds arrows until that dragon disappears', async () => {
    const { bot, fight, state, dragon, engage } = await scenario();
    await engage();
    dragon.faceEntity = 32770;
    await fight.execute();
    expect(bot.targetIdx).toBeNull();
    expect(fight.blocksLoot()).toBe(true);
    state.npcs = [];
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(bot.killsTotal).toBe(0);
});

test('loot checks ownership again after asynchronous movement', async () => {
    const { state, task, engage } = await scenario();
    spyOn(Reachability, 'canReach').mockReturnValue(false);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { await engage(); return true; });
    await task('LootCorpse').execute();
    expect(state.takes).toBe(0);
});

test('no ammo still selects banking above an owned fight and its arrows', async () => {
    const { bot, state, task, engage } = await scenario();
    await engage();
    state.ammo = 0;
    let banked = false;
    spyOn(task('BankRun'), 'execute').mockImplementation(async () => { banked = true; });
    await bot.loop();
    expect(banked).toBe(true);
    expect(state.takes).toBe(0);
});

test('banking discards old ownership without claiming the absent dragon as a kill', async () => {
    const { bot, state, task, engage } = await scenario();
    await engage();
    spyOn(supply, 'bankRoutine').mockResolvedValue(undefined);
    await task('BankRun').execute();
    state.npcs = [];
    await bot.loop();
    expect(bot.killsTotal).toBe(0);
    expect(state.takes).toBe(1);
});

test('a scene rebuild during completion cannot turn an empty snapshot into a kill', async () => {
    const { bot, fight, state, engage } = await scenario();
    await engage();
    state.npcs = [];
    spyOn(Game, 'sceneReady').mockReturnValue(false);
    await fight.execute();
    expect(bot.killsTotal).toBe(0);
    expect(bot.targetIdx).toBe(17);
});

test('a scene rebuild cannot release an abandoned living target for pickup', async () => {
    const { fight, state, task, engage } = await scenario();
    await engage();
    fight['clearTarget']();
    state.npcs = [];
    spyOn(Game, 'sceneReady').mockReturnValue(false);
    await task('LootCorpse').execute();
    expect(state.takes).toBe(0);
});

for (const [site, style] of [['taverley-blue', 'range'], ['heroes-blue', 'mage'], ['brimhaven-iron', 'melee']]) {
    test(`${site} ${style} also defers loot for its owned target`, async () => {
        const { state, task, engage } = await scenario(site, style);
        expect(await task('LootCorpse').validate()).toBe(true);
        await engage();
        await task('LootCorpse').execute();
        expect(state.takes).toBe(0);
    });
}

test('a chase stall abandons credit without releasing the living target for loot', async () => {
    const { bot, fight, state, engage } = await scenario('brimhaven-iron', 'melee');
    await engage();
    state.now += 91_000;
    await fight.execute();
    expect(bot.targetIdx).toBeNull();
    expect(fight.blocksLoot()).toBe(true);
    expect(bot.killsTotal).toBe(0);
});

test('a new engagement replaces an abandoned hold and yields its own corpse loot', async () => {
    const { bot, fight, state, dragon, engage } = await scenario();
    await engage();
    fight['clearTarget']();
    const next = { ...dragon, index: 18, inCombat: false };
    state.npcs.push(next);
    await fight['engage'](new Npc(next), 'Black dragon');
    state.npcs = [dragon];
    await bot.loop();
    await bot.loop();
    expect(bot.killsTotal).toBe(1);
    expect(state.takes).toBe(1);
});

test('a full pack keeps its food until completion then makes a slot and loots', async () => {
    const { bot, state, engage } = await scenario();
    await engage();
    state.full = true;
    state.npcs = [];
    await bot.loop();
    expect(bot.killsTotal).toBe(1);
    expect(state.drops).toBe(0);
    await bot.loop();
    expect(state.drops).toBe(1);
    await bot.loop();
    expect(state.takes).toBe(1);
});
