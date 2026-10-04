import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const [site, x, z] of [
    ['taverley-blue', 2898, 9788],
    ['heroes-blue', 2925, 9908],
    ['gutanoth-blue', 2588, 9440],
    ['brimhaven-iron', 2728, 9440]
] as const) {
    test(`${site} melee attacks an available nearby target before returning to its anchor`, async () => {
        const { bot, state, dragon, task } = await scenario(site, 'melee', { rotateSpawns: false });
        state.ground = false;
        dragon.inCombat = false;
        dragon.tile = { x: x + 3, z, level: 0 };
        spyOn(Game, 'tile').mockReturnValue(new Tile(x, z, 0));
        for (const name of ['WalkToSpot', 'HoldSafespot']) spyOn(task(name), 'validate').mockRestore();
        spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0 || state.now > 15000);

        await bot.loop();

        expect(state.walks).toBe(0);
        expect(state.attacks).toBe(1);
        expect(bot.targetIdx).toBe(17);
    });
}

test('normal melee loots a kill then attacks the next nearby dragon without returning to the anchor', async () => {
    const { bot, fight, state, dragon, task, engage } = await scenario('taverley-blue', 'melee');
    await engage();
    state.npcs = [];
    await fight.execute();
    state.npcs = [{ ...dragon, index: 92, inCombat: false, tile: { x: 2901, z: 9788, level: 0 } }];
    spyOn(Game, 'tile').mockReturnValue(new Tile(2898, 9788, 0));
    for (const name of ['WalkToSpot', 'HoldSafespot']) spyOn(task(name), 'validate').mockRestore();
    const before = state.attacks;
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > before || state.now > 20000);

    await bot.loop();
    expect(state.takes).toBe(1);
    expect(state.attacks).toBe(before);
    await bot.loop();
    expect(bot.targetIdx).toBe(92);
    expect(state.walks).toBe(0);
});

for (const excluded of ['absent', 'dying', 'claimed', 'busy', 'too far', 'outside site', 'skipped']) {
    test(`melee still returns to the anchor when the only candidate is ${excluded}`, async () => {
        const { fight, state, dragon, task } = await scenario('taverley-blue', 'melee');
        spyOn(Game, 'tile').mockReturnValue(new Tile(2898, 9788, 0));
        Object.assign(dragon, { inCombat: false, tile: { x: 2901, z: 9788, level: 0 } });
        if (excluded === 'absent') state.npcs = [];
        if (excluded === 'dying') dragon.health = 0;
        if (excluded === 'claimed') dragon.faceEntity = 32770;
        if (excluded === 'busy') dragon.inCombat = true;
        if (excluded === 'too far') dragon.distance = 11;
        if (excluded === 'outside site') dragon.tile = { x: 2880, z: 9788, level: 0 };
        if (excluded === 'skipped') fight['skip'].set(dragon.index, state.now + 10000);
        for (const name of ['WalkToSpot', 'HoldSafespot']) {
            spyOn(task(name), 'validate').mockRestore();
            expect(task(name).validate()).toBe(true);
        }
    });
}

for (const style of ['range', 'mage']) {
    test(`${style} still returns to its safespot with a nearby target`, async () => {
        const { dragon, task } = await scenario('taverley-blue', style);
        dragon.inCombat = false;
        spyOn(Game, 'tile').mockReturnValue(new Tile(2898, 9788, 0));
        for (const name of ['WalkToSpot', 'HoldSafespot']) {
            spyOn(task(name), 'validate').mockRestore();
            expect(task(name).validate()).toBe(true);
        }
    });
}

test('normal melee skips a failed approach instead of repeatedly selecting the blocked dragon', async () => {
    const { fight, state, dragon } = await scenario('taverley-blue', 'melee');
    dragon.inCombat = false;
    spyOn(Reachability, 'canReach').mockReturnValue(false);
    const walk = spyOn(Traversal, 'walkResilient').mockImplementation(async () => { state.walks++; return false; });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.walks > 0);
    await fight.execute();
    const until = state.now + 2000;
    spyOn(EventSignal, 'pending').mockImplementation(() => state.now >= until);
    await fight.execute();
    expect(walk).toHaveBeenCalledTimes(1);
    expect(state.attacks).toBe(0);
});
