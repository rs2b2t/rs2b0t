import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const gap of [8, 10, 4]) {
    test(`latest network gap ${gap} controls firing despite rendered gap six`, async () => {
        const { fight, state, dragon } = await scenario('taverley-blue');
        const spot = Game.tile();
        if (!spot) throw new Error('Missing stand');
        dragon.inCombat = false;
        dragon.tile = { x: spot.x + 7, z: spot.z, level: spot.level };
        Object.assign(dragon, { networkTile: { x: spot.x + gap + 1, z: spot.z, level: spot.level } });
        spyOn(EventSignal, 'pending').mockImplementation(() => state.attacks > 0 || state.now >= 12_000);

        await fight.execute();

        expect(state.attacks).toBe(gap <= 6 ? 1 : 0);
        expect(state.walks).toBe(0);
    });
}

for (const change of ['range', 'claim', 'identity', 'los', 'anchor']) {
    test(`rechecks ${change} after asynchronous special without releasing ownership`, async () => {
        const { bot, fight, state, dragon, engage } = await scenario();
        await engage();
        const before = state.attacks;
        spyOn(bot, 'armSpecial').mockImplementation(async () => {
            if (change === 'range') Object.assign(dragon, { networkTile: { ...dragon.tile, x: dragon.tile.x + 12 } });
            if (change === 'claim') dragon.faceEntity = 32770;
            if (change === 'identity') state.npcs = [{ ...dragon, id: 999 }];
            if (change === 'los') spyOn(Reachability, 'lineOfSight').mockReturnValue(false);
            if (change === 'anchor') bot.setSafespotIndex(1);
        });

        await fight['engage'](new Npc(dragon), 'Black dragon');

        expect(state.attacks).toBe(before);
        expect(fight.blocksLoot()).toBe(true);
        expect(bot.targetIdx).toBe(17);
        expect(fight['skip'].has(17)).toBe(false);
        expect(bot.killsTotal).toBe(0);
    });
}
