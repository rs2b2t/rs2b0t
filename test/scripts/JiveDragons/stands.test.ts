import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

test('a live stand change finishes the current fight and loot before moving the shared fight anchor', async () => {
    const { bot, fight, state, task, engage } = await scenario('gutanoth-blue', 'melee', { meleeTile: new Tile(2587, 9468, 0) });
    const saved = spyOn(SettingsStore, 'save').mockImplementation(() => {});
    const switchStand = task('SwitchStand');
    spyOn(switchStand, 'validate').mockRestore();
    let here = new Tile(2585, 9468, 0);
    spyOn(Game, 'tile').mockImplementation(() => here);
    const walk = spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { here = new Tile(tile.x, tile.z, tile.level); return true; });
    await engage();
    bot.requestStand(2);
    expect(switchStand.validate()).toBe(false);
    expect(fight['anchor']()).toEqual(new Tile(2587, 9468, 0));

    state.npcs = [];
    await fight.execute();
    expect(bot.killsTotal).toBe(1);
    expect(switchStand.validate()).toBe(false);
    await task('LootCorpse').execute();
    expect(state.takes).toBe(1);
    expect(switchStand.validate()).toBe(true);
    await switchStand.execute();
    expect(fight['anchor']()).toEqual(new Tile(2574, 9430, 0));
    expect(here).toEqual(new Tile(2574, 9430, 0));
    expect(switchStand.validate()).toBe(false);
    expect(walk).toHaveBeenCalledTimes(1);
    expect(saved).toHaveBeenCalledWith('JiveDragons', 'meleeTile', '');
});

test('melee rotation loots a kill before choosing another spawn beyond the old field', async () => {
    const { bot, fight, state, dragon, task, engage } = await scenario('taverley-blue', 'melee', { rotateSpawns: true });
    await engage();
    state.npcs = [];
    await fight.execute();
    expect(bot.killsTotal).toBe(1);
    state.npcs = [
        { ...dragon, inCombat: false },
        { ...dragon, index: 92, inCombat: false, distance: 24, tile: { x: 2898, z: 9788, level: 0 } }
    ];
    const before = state.attacks;
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > before);
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(bot.targetIdx).toBeNull();
    spyOn(Game, 'tile').mockReturnValue(new Tile(2898, 9788, 0));
    for (const name of ['WalkToSpot', 'HoldSafespot']) {
        spyOn(task(name), 'validate').mockRestore();
        expect(task(name).validate()).toBe(false);
    }
    await bot.loop();
    expect(bot.targetIdx).toBe(92);
});

test.each([false, true])('expanded melee field preserves site boundaries and other fights (rotation %s)', async rotateSpawns => {
    const { fight, state, dragon } = await scenario('taverley-blue', 'melee', { rotateSpawns });
    state.npcs = [
        { ...dragon, index: 90, inCombat: false, distance: 24, tile: { x: 2898, z: 9788, level: 0 } },
        { ...dragon, index: 91, inCombat: false, distance: 24, tile: { x: 2880, z: 9788, level: 0 } },
        { ...dragon, index: 92, inCombat: false, faceEntity: 32770, distance: 24, tile: { x: 2898, z: 9788, level: 0 } },
        { ...dragon, index: 93, inCombat: true, distance: 24, tile: { x: 2898, z: 9788, level: 0 } }
    ];
    expect(fight['field'](10).map(n => n.index)).toEqual(rotateSpawns ? [90] : []);
});


test('an unreachable stand restores the old anchor and stops retrying the request', async () => {
    const { bot, fight, state, task } = await scenario('gutanoth-blue', 'melee', { meleeTile: new Tile(2587, 9468, 0) });
    const saved = spyOn(SettingsStore, 'save').mockImplementation(() => {});
    state.ground = false;
    state.npcs = [];
    const switchStand = task('SwitchStand');
    spyOn(switchStand, 'validate').mockRestore();
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    bot.requestStand(2);
    await switchStand.execute();
    expect(switchStand.validate()).toBe(false);
    expect(fight['anchor']()).toEqual(new Tile(2587, 9468, 0));
    expect(saved).not.toHaveBeenCalledWith('JiveDragons', 'meleeTile', '');
    expect(saved).not.toHaveBeenCalledWith('JiveDragons', 'safespot1', '');
    expect(bot.activeStand).toBe(1);
    expect(saved).toHaveBeenLastCalledWith('JiveDragons', 'stand', '1');
});

test('rotation retains a living target while another less recently killed spawn is available', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue', 'melee', { rotateSpawns: true });
    await engage();
    state.npcs = [];
    await fight.execute();
    state.npcs = [{ ...dragon, inCombat: false }];
    await engage();
    state.npcs.push({ ...dragon, index: 92, inCombat: false, distance: 24, tile: { x: 2898, z: 9788, level: 0 } });
    const until = state.now + 6000;
    spyOn(EventSignal, 'pending').mockImplementation(() => state.now >= until);
    await fight.execute();
    expect(bot.targetIdx).toBe(17);
});


test('rotation skips a spawn whose approach fails and attacks the next reachable dragon', async () => {
    const { bot, fight, state, dragon } = await scenario('taverley-blue', 'melee', { rotateSpawns: true });
    state.npcs = [
        { ...dragon, index: 91, inCombat: false, distance: 20, tile: { x: 2898, z: 9788, level: 0 } },
        { ...dragon, index: 92, inCombat: false, distance: 24, tile: { x: 2900, z: 9788, level: 0 } }
    ];
    spyOn(Reachability, 'canReach').mockImplementation(tile => tile.x !== 2898);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0);
    await fight.execute();
    expect(bot.targetIdx).toBe(92);
});
