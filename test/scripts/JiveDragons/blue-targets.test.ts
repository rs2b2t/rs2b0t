import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

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
