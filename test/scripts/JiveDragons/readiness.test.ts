import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const arrival of ['selection', 'waiting']) {
    test(`ready black dragon wins over an unowned far leash at ${arrival}`, async () => {
        const { fight, state, dragon } = await scenario('taverley-black');
        const spot = Game.tile();
        if (!spot) throw new Error('Missing stand');
        dragon.inCombat = false;
        dragon.tile = { x: spot.x + 8, z: spot.z, level: spot.level };
        dragon.distance = 8;
        fight['seen'].set(dragon.index, { ...dragon.tile, since: 0, at: state.now });
        const ready = { ...dragon, index: 18, distance: 9.9, tile: { x: spot.x + 7, z: spot.z + 7, level: spot.level } };
        if (arrival === 'selection') state.npcs.push(ready);
        let ticks = 0;
        const attacks: number[] = [];
        spyOn(Execution, 'delayTicks').mockImplementation(async () => {
            ticks++;
            state.now += 600;
            if (arrival === 'waiting' && ticks === 1) state.npcs.push(ready);
        });
        spyOn(Npc.prototype, 'interact').mockImplementation(function (this: Npc) { attacks.push(this.index); return true; });
        spyOn(EventSignal, 'pending').mockImplementation(() => attacks.length > 0 || ticks >= 3);

        await fight.execute();

        expect(attacks).toEqual([18]);
        expect(fight['skip'].has(dragon.index)).toBe(false);
        expect(state.walks).toBe(0);
    });
}

for (const condition of ['claimed', 'combat-face-gap', 'skipped', 'blocked', 'owned']) {
    test(`${condition} does not interrupt a waiting black leash`, async () => {
        const { fight, bot, state, dragon, engage } = await scenario('taverley-black');
        const spot = Game.tile();
        if (!spot) throw new Error('Missing stand');
        dragon.inCombat = false;
        if (condition === 'owned') await engage();
        state.now += 5000;
        dragon.tile = { x: spot.x + 8, z: spot.z, level: spot.level };
        fight['seen'].set(dragon.index, { ...dragon.tile, since: 0, at: state.now });
        const ready = { ...dragon, index: 18, distance: 4, tile: { x: spot.x + 5, z: spot.z, level: spot.level } };
        if (condition === 'claimed') ready.faceEntity = 32770;
        if (condition === 'combat-face-gap') ready.inCombat = true;
        if (condition === 'skipped') fight['skip'].set(18, state.now + 20_000);
        if (condition === 'blocked') spyOn(Reachability, 'lineOfSight').mockImplementation((_from, to) => to.x !== spot.x + 4);
        let ticks = 0;
        spyOn(Execution, 'delayTicks').mockImplementation(async () => {
            ticks++;
            state.now += 600;
            if (ticks === 1) state.npcs.push(ready);
        });
        spyOn(EventSignal, 'pending').mockImplementation(() => ticks >= 3);
        const before = state.attacks;

        await fight.execute();

        expect(state.attacks).toBe(before);
        expect(bot.targetIdx).toBe(17);
        expect(fight['skip'].has(17)).toBe(false);
    });
}

for (const site of ['taverley-blue', 'taverley-black']) {
    test(`${site} attacks a moving unclaimed dragon within two in-range opportunities`, async () => {
        const { bot, state, dragon } = await scenario(site);
        state.ground = false;
        dragon.inCombat = false;
        const spot = Game.tile();
        if (!spot) throw new Error('Missing stand');
        dragon.tile = { x: spot.x + 7, z: spot.z, level: spot.level };
        spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0);

        await bot.loop();
        dragon.tile.z++;
        await bot.loop();

        expect(state.attacks).toBe(1);
        expect(state.walks).toBe(0);
    });
}

for (const condition of ['occluded', 'claimed', 'combat-face-gap', 'skipped', 'out-of-range']) {
    test(`unsettled eligibility still rejects ${condition} candidates`, async () => {
        const { bot, fight, state, dragon } = await scenario();
        state.ground = false;
        dragon.inCombat = condition === 'combat-face-gap';
        if (condition === 'occluded') spyOn(Reachability, 'lineOfSight').mockReturnValue(false);
        if (condition === 'claimed') dragon.faceEntity = 32770;
        if (condition === 'skipped') fight['skip'].set(dragon.index, state.now + 5000);
        if (condition === 'out-of-range') dragon.tile.x += 6;

        await bot.loop();
        dragon.tile.z++;
        await bot.loop();

        expect(state.attacks).toBe(0);
        expect(state.walks).toBe(0);
    });
}

test('an owned target retains preference over a closer unsettled candidate', async () => {
    const { bot, state, dragon, engage } = await scenario();
    state.ground = false;
    await engage();
    state.npcs.push({ ...dragon, index: 18, distance: 1, inCombat: false });
    const attacks: number[] = [];
    spyOn(Npc.prototype, 'interact').mockImplementation(function (this: Npc) { attacks.push(this.index); return true; });
    spyOn(EventSignal, 'pending').mockImplementation(() => attacks.length > 0);

    await bot.loop();

    expect(attacks).toEqual([17]);
});
