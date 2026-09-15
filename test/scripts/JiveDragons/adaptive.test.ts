import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const pose of [{ z: 9822, x: 2834 }, { z: 9823, x: 2835 }]) {
    test(`network body 2837,${pose.z} chooses nearest visible existing stand`, async () => {
        const { bot, fight, state, dragon } = await scenario();
        state.ground = false;
        dragon.inCombat = false;
        dragon.size = 4;
        Object.assign(dragon, { networkTile: { x: 2839, z: pose.z + 2, level: 0 } });
        spyOn(Reachability, 'lineOfSight').mockImplementation(from => from.x <= pose.x);
        const walks: Tile[] = [];
        let here = new Tile(2836, 9817, 0);
        spyOn(Game, 'tile').mockImplementation(() => here);
        spyOn(DirectNavigator, 'walk').mockImplementation(async tile => { walks.push(Tile.from(tile)); here = Tile.from(tile); return true; });
        spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0 || state.now > 12_000);

        await bot.loop();

        expect(walks).toEqual([new Tile(pose.x, 9817, 0)]);
        expect(state.attacks).toBe(1);
        expect(fight.blocksLoot()).toBe(true);
    });
}

for (const condition of ['ready', 'owned', 'pending', 'friendly', 'skipped']) {
    test(`adaptive stand holds for ${condition}`, async () => {
        const { fight, state, dragon, engage } = await scenario();
        dragon.inCombat = false;
        if (condition === 'owned' || condition === 'pending') await engage();
        if (condition === 'pending') fight['clearTarget']();
        if (condition === 'friendly') dragon.faceEntity = 32770;
        if (condition === 'skipped') fight['skip'].set(17, state.now + 10_000);
        spyOn(Reachability, 'lineOfSight').mockImplementation(from => condition === 'ready' || from.x === 2834);
        const walk = spyOn(DirectNavigator, 'walk').mockImplementation(() => true);

        await fight['ladder']();

        expect(walk).not.toHaveBeenCalled();
    });
}

test('selected stand remains latched during walking and arrival rechecks network readiness', async () => {
    const { fight, state, dragon } = await scenario();
    dragon.inCombat = false;
    const arrived = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let here = new Tile(2836, 9817, 0);
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(Reachability, 'lineOfSight').mockImplementation(from => from.x === 2834);
    const walk = spyOn(DirectNavigator, 'walk').mockImplementation(async tile => {
        started.resolve();
        await arrived.promise;
        here = Tile.from(tile);
        return true;
    });
    const execution = fight.execute();
    await started.promise;
    Object.assign(dragon, { networkTile: { ...dragon.tile, x: dragon.tile.x + 20 } });
    arrived.resolve();

    await execution;

    expect(walk).toHaveBeenCalledTimes(1);
    expect(state.attacks).toBe(0);
    expect(here).toEqual(new Tile(2834, 9817, 0));
});
