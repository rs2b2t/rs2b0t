import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { DirectNavigator } from '#/bot/event/webwalk/DirectNavigator.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { lootScenario } from './loot.fixture.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const obstruction of ['far', 'LOS']) {
    for (const replacement of [false, true]) {
        test(`bounded ${obstruction} recovery ${replacement ? 'selects a safe Blue' : 'keeps living loot suppressed without a kill'}`, async () => {
            const { bot, fight, state, dragon, engage, task } = await scenario('taverley-blue');
            await engage();
            if (replacement) state.npcs.push({ ...dragon, index: 92, inCombat: false });
            state.npcs = state.npcs.map(n => n.index === dragon.index ? { ...n, networkTile: { ...dragon.tile, x: dragon.tile.x + (obstruction === 'far' ? 14 : 1) } } : n);
            if (obstruction === 'LOS') spyOn(Reachability, 'lineOfSight').mockImplementation((_from, to) => to.x === dragon.tile.x - 1);
            spyOn(reader, 'selfFaceEntity').mockReturnValue(dragon.index);
            spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 1);
            const startedAt = state.now;

            for (let pass = 0; pass < 36 && state.attacks === 1; pass++) {
                await fight.execute();
                expect(task('LootCorpse').validate()).toBe(false);
                if (state.now - startedAt < 20_000) expect(bot.targetIdx).toBe(17);
            }

            expect(bot.targetIdx).toBe(replacement ? 92 : null);
            expect(state.attacks).toBe(replacement ? 2 : 1);
            expect(state.walks).toBe(0);
            expect(fight.blocksLoot()).toBe(true);
            expect(bot.killsTotal).toBe(0);
        });
    }
}

test('abandoned Blue disappearance grants no kill and releases its loot hold', async () => {
    const { bot, fight, state, dragon, engage, task } = await scenario('taverley-blue');
    await engage();
    state.npcs = [{ ...dragon, networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } }];
    for (let pass = 0; pass < 36; pass++) await fight.execute();
    expect(bot.targetIdx).toBeNull();
    state.npcs = [];

    await fight.execute();
    await task('LootCorpse').execute();

    expect(bot.killsTotal).toBe(0);
    expect(state.takes).toBe(1);
});

test('attackable owned Blue survives a long dry damage roll with a closer alternative', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue');
    await engage();
    state.npcs.push({ ...dragon, index: 92, inCombat: false, distance: 1 });
    spyOn(EventSignal, 'pending').mockImplementation(() => state.now >= 55_000);

    await fight.execute();

    expect(bot.targetIdx).toBe(17);
    expect(fight.blocksLoot()).toBe(true);
    expect(bot.killsTotal).toBe(0);
    expect(state.walks).toBe(0);
});

test('an attackable interval restarts the bounded unattackable watch', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue');
    await engage();
    state.npcs = [{ ...dragon, networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } }];
    for (let pass = 0; pass < 25; pass++) await fight.execute();
    state.npcs = [dragon];
    spyOn(bot, 'armSpecial').mockImplementation(async () => {
        state.npcs = [{ ...dragon, networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } }];
    });
    await fight.execute();

    for (let pass = 0; pass < 25; pass++) await fight.execute();

    expect(bot.targetIdx).toBe(17);
    expect(fight.blocksLoot()).toBe(true);
});

test('damage between consecutive same-anchor empty-field calls advances the safe stand', async () => {
    const { bot, fight, state, dragon, engage } = await scenario('taverley-blue');
    await engage();
    state.npcs = [{ ...dragon, networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } }];
    let here = Game.tile();
    spyOn(Game, 'tile').mockImplementation(() => here);
    spyOn(DirectNavigator, 'walk').mockImplementation(async tile => { here = tile; state.walks++; return true; });
    await fight.execute();
    spyOn(Skills, 'effective').mockReturnValue(90);

    await fight.execute();

    expect(bot.safespotIndex()).toBe(1);
    expect(here).toMatchObject({ x: 2904, z: 9808, level: 0 });
    expect(state.walks).toBe(1);
    expect(bot.targetIdx).toBe(17);
});

for (const movement of ['HoldSafespot', 'WalkToSpot', 'Retreat']) {
    test(`${movement} interruption discards pre-travel HP history`, async () => {
        const { bot, fight, state, dragon, engage, task } = await scenario('taverley-blue');
        await engage();
        state.npcs = [{ ...dragon, networkTile: { ...dragon.tile, x: dragon.tile.x + 14 } }];
        const anchor = Game.tile();
        if (!anchor) throw new Error('Missing anchor');
        let here = anchor;
        spyOn(Game, 'tile').mockImplementation(() => here);
        spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { here = tile; return true; });
        spyOn(DirectNavigator, 'walk').mockImplementation(async tile => { here = tile; return true; });
        await fight.execute();
        here = new Tile(anchor.x + 1, anchor.z, anchor.level);
        spyOn(Skills, 'effective').mockReturnValue(90);
        await task(movement).execute();
        here = anchor;
        state.now += 600;

        await fight.execute();

        expect(bot.safespotIndex()).toBe(0);
        expect(bot.targetIdx).toBe(17);
    });
}

test('a quick loot round trip discards pre-loot HP history', async () => {
    const { bot, fight, world, anchor, drop, task } = await lootScenario({}, 'taverley-blue');
    await fight.execute();
    drop(892, undefined, 4);
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        world.here = Tile.from(tile);
        world.hp = 90;
        return true;
    });
    await task('LootCorpse').execute();
    expect(world.here).toEqual(anchor);

    await fight.execute();

    expect(bot.safespotIndex()).toBe(0);
});
