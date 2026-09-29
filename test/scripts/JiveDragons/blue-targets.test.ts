import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';
import Tile from '#/bot/geometry/Tile.js';

afterEach(restoreScenario);

test('melee finishes counting a dying target before adopting the next attacker', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue', 'melee');
    await engage();
    dragon.health = 0;
    state.npcs.push({ ...dragon, index: 92, health: 100, faceEntity: 32769 });
    const now = state.now;
    spyOn(EventSignal, 'pending').mockImplementation(() => state.now > now);

    await fight.execute();

    expect(state.attacks).toBe(1);
    expect(bot.targetIdx).toBe(17);
    state.npcs = state.npcs.filter(n => n.index !== 17);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    await fight.execute();
    expect(bot.killsTotal).toBe(1);
});

test.each(['claimed', 'event', 'despawn'])('melee revalidates after special preparation: %s', async change => {
    const { bot, fight, state, dragon } = await scenario('heroes-blue', 'melee');
    dragon.inCombat = false;
    spyOn(bot, 'armSpecial').mockImplementation(async () => {
        if (change === 'claimed') dragon.inCombat = true;
        if (change === 'event') spyOn(EventSignal, 'pending').mockReturnValue(true);
        if (change === 'despawn') state.npcs = [];
    });

    expect(await fight['engage'](new Npc(dragon), 'blue dragon')).toBe(false);
    expect(state.attacks).toBe(0);
});

test('greater demon mode does not try to bury ashes when bone burial was saved', async () => {
    const { bot } = await scenario('gutanoth-blue', 'melee', { enclaveTargets: 'demons', buryBones: true });
    expect(bot.buryBones()).toBe(false);
});

test.each(['dragons', 'demons', 'both'])('Gu\'Tanoth %s target setting reaches the fight scheduler', async mode => {
    const { fight, state, dragon } = await scenario('gutanoth-blue', 'melee', { enclaveTargets: mode });
    dragon.inCombat = false;
    state.npcs.push({ ...dragon, index: 92, name: 'Greater demon' });
    expect(fight['field'](10).map(n => n.name)).toEqual([mode === 'demons' ? 'Greater demon' : 'Blue dragon']);
    state.npcs = state.npcs.filter(n => n.name !== 'Blue dragon');
    expect(fight['field'](10).map(n => n.name)).toEqual(mode === 'dragons' ? [] : ['Greater demon']);
});

test('Gu\'Tanoth defends against an attacking chieftain but never targets an ogre shaman', async () => {
    const { bot, fight, state, dragon } = await scenario('gutanoth-blue', 'melee', { enclaveTargets: 'demons' });
    state.npcs = [
        { ...dragon, index: 91, name: 'Ogre shaman', faceEntity: 32769 },
        { ...dragon, index: 92, name: 'Ogre chieftain', faceEntity: 32769 },
        { ...dragon, index: 93, name: 'Greater demon', inCombat: false }
    ];
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0 || state.now > 15000);

    await fight.execute();

    expect(bot.targetIdx).toBe(92);
    expect(fight['field'](10).map(n => n.index)).toEqual([92, 93]);
});

test.each([true, false])('Heroes melee crosses the pen gate before attacking: walk %s', async reached => {
    const { fight, dragon } = await scenario('heroes-blue', 'melee');
    dragon.inCombat = false;
    let accessible = false;
    spyOn(Reachability, 'canReach').mockImplementation(() => accessible);
    const walk = spyOn(Traversal, 'walkResilient').mockImplementation(async () => { accessible = reached; return reached; });
    const attack = spyOn(Npc.prototype, 'interact').mockImplementation(() => {
        expect(accessible).toBe(true);
        return true;
    });

    expect(await fight['engage'](new Npc(dragon), 'blue dragon')).toBe(reached);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(attack).toHaveBeenCalledTimes(reached ? 1 : 0);
});

test('blue melee switches from a selected dragon to the adult attacking us', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue', 'melee');
    await engage();
    state.npcs.push({ ...dragon, index: 92, faceEntity: 32769 });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 1 || state.now > 15000);

    await fight.execute();

    expect(state.attacks).toBe(2);
    expect(bot.targetIdx).toBe(92);
});

test('blue melee keeps the current attacker when another NPC also faces us', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue', 'melee');
    await engage();
    dragon.faceEntity = 32769;
    state.npcs.unshift({ ...dragon, index: 92 });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 1 || state.now > 15000);

    await fight.execute();

    expect(bot.targetIdx).toBe(17);
});

test('blue melee finishes an attacking baby without targeting passive babies or counting a live one dead', async () => {
    const { bot, fight, state, dragon } = await scenario('taverley-blue', 'melee');
    dragon.inCombat = false;
    const baby = { ...dragon, index: 92, name: 'Baby blue dragon', size: 1, faceEntity: 32769 };
    state.npcs.push(baby, { ...baby, index: 93, faceEntity: -1 });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0 || state.now > 15000);

    await fight.execute();

    expect(bot.targetIdx).toBe(92);
    baby.faceEntity = -1;
    expect(fight['field'](10).map(n => n.index)).toEqual([92, 17]);
    expect(fight['settleKill']('blue dragon')).toBe(false);
    expect(bot.killsTotal).toBe(0);
    state.npcs = state.npcs.filter(n => n.index !== 92);
    expect(fight['settleKill']('blue dragon')).toBe(true);
    expect(bot.killsTotal).toBe(0);
});

test.each(['taverley-blue', 'heroes-blue', 'gutanoth-blue'])('%s melee attacks an adult beyond adjacency instead of waiting at the anchor', async site => {
    const { bot, fight, state, dragon } = await scenario(site, 'melee');
    dragon.inCombat = false;
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0 || state.now > 15000);

    await fight.execute();

    expect(state.attacks).toBe(1);
    expect(bot.targetIdx).toBe(17);
});

test('blue melee keeps fighting away from the anchor without a walk-back interrupt', async () => {
    const fixture = await scenario('taverley-blue', 'melee');
    await fixture.engage();
    spyOn(Game, 'tile').mockReturnValue(new Tile(2908, 9808, 0));
    const walk = fixture.task('WalkToSpot');
    spyOn(walk, 'validate').mockRestore();
    expect(walk.validate()).toBe(false);
    expect(fixture.fight.validate()).toBe(true);
});

test('blue melee disables auto-retaliate so another dragon cannot steal the chase', async () => {
    const fixture = await scenario('taverley-blue', 'melee');
    const task = fixture.task('SetRetaliate');
    spyOn(task, 'validate').mockRestore();
    let enabled = true;
    spyOn(Game, 'autoRetaliateOn').mockImplementation(() => enabled);
    spyOn(Game, 'setAutoRetaliate').mockImplementation(value => { enabled = value; return true; });
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(enabled).toBe(false);
});

for (const index of [17, 93]) {
    test(`far unowned blue ${index} never becomes a leash target`, async () => {
        const { bot, fight, state, dragon } = await scenario('taverley-blue');
        dragon.index = index;
        dragon.inCombat = false;
        Object.assign(dragon, { networkTile: { ...dragon.tile, x: dragon.tile.x + 7 } });
        fight['seen'].set(index, { x: dragon.tile.x + 7, z: dragon.tile.z, since: 0, at: 0 });
        spyOn(EventSignal, 'pending').mockImplementation(() => state.now >= 15_000);

        await fight.execute();

        expect(state.attacks).toBe(0);
        expect(bot.targetIdx).toBeNull();
        expect(state.walks).toBe(0);
        expect(fight.blocksLoot()).toBe(false);
        expect(fight['skip'].size).toBe(0);
    });
}

test('far primary does not mask a nearby network-ready blue', async () => {
    const { bot, fight, state, dragon } = await scenario('taverley-blue');
    dragon.inCombat = false;
    Object.assign(dragon, { networkTile: { ...dragon.tile, x: dragon.tile.x + 7 } });
    state.npcs.push({ ...dragon, index: 92, networkTile: { ...dragon.tile }, distance: 20 });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0);

    await fight.execute();

    expect(state.attacks).toBe(1);
    expect(bot.targetIdx).toBe(92);
    expect(state.walks).toBe(0);
});

for (const rejection of ['blocked', 'foreign', 'skipped']) {
    test(`nearby ${rejection} blue remains rejected`, async () => {
        const { bot, fight, state, dragon } = await scenario('taverley-blue');
        dragon.inCombat = false;
        if (rejection === 'blocked') spyOn(Reachability, 'lineOfSight').mockReturnValue(false);
        if (rejection === 'foreign') dragon.faceEntity = 32770;
        if (rejection === 'skipped') fight['skip'].set(dragon.index, state.now + 60_000);

        await fight.execute();

        expect(state.attacks).toBe(0);
        expect(bot.targetIdx).toBeNull();
    });
}

for (const movement of ['far', 'blocked']) {
    test(`owned live blue keeps ownership when ${movement} instead of switching to a ready blue`, async () => {
        const { bot, fight, state, dragon, engage } = await scenario('taverley-blue');
        await engage();
        state.npcs.push({ ...dragon, index: 92, inCombat: false });
        if (movement === 'far') Object.assign(dragon, { networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } });
        if (movement === 'blocked') {
            dragon.tile = { ...dragon.tile, z: dragon.tile.z + 1 };
            spyOn(Reachability, 'lineOfSight').mockImplementation((_from, to) => to.z === dragon.tile.z - 2);
        }
        state.now += 5_000;
        spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 1 || state.now >= 17_000);

        await fight.execute();

        expect(state.attacks).toBe(1);
        expect(bot.targetIdx).toBe(17);
        expect(fight.blocksLoot()).toBe(true);
        expect(state.walks).toBe(0);
    });
}

test('selected second stand supplies the current network LOS origin', async () => {
    const { bot, fight, dragon } = await scenario('taverley-blue');
    bot.setSafespotIndex(1);
    spyOn(Game, 'tile').mockReturnValue({ x: 2904, z: 9808, level: 0 });
    dragon.inCombat = false;
    const sight = spyOn(Reachability, 'lineOfSight').mockReturnValue(true);

    const attacked = await fight['engage'](new Npc(dragon), 'Blue dragon');

    expect(attacked).toBe(true);
    expect(sight.mock.calls[0]?.[0]).toMatchObject({ x: 2904, z: 9808, level: 0 });
});

test('owned live blue holds the selected stand through a blind timeout', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue');
    await engage();
    Object.assign(dragon, { networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } });
    fight['blindSince'] = state.now - 180_000;
    fight['polledAt'] = state.now;
    let here = Game.tile();
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(DirectNavigator, 'walk').mockImplementation(async tile => {
        state.walks++;
        here = tile;
        return true;
    });

    const step = await fight['ladder']();

    expect(step).toBe('held');
    expect(bot.safespotIndex()).toBe(0);
    expect(bot.targetIdx).toBe(17);
    expect(state.walks).toBe(0);
    expect(fight.blocksLoot()).toBe(true);
});
