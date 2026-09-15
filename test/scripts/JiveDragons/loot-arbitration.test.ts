import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { held, lootScenario } from './loot.fixture.js';
import { restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const nonfitting of [false, true]) {
    test(`capacity banking lets a full pending return fit arrows with nonfitting drops=${nonfitting}`, async () => {
        const { bot, world, drop } = await lootScenario({ foodReserve: 27 });
        world.pack = [...Array.from({ length: 27 }, () => held(1617)), held(892, 100)];
        bot.lootRun = { food: [] };
        if (nonfitting) {
            drop(536);
            drop(1747);
        }
        drop(892, undefined, 3);

        await bot.loop();

        expect(world.events.filter(e => e.action !== 'Walk').map(e => [e.action, e.id])).toEqual([['Take', 892]]);
        expect(world.pack.filter(item => item.id === 1617)).toHaveLength(27);
        await bot.loop();
        expect(world.events.at(-1)?.action).toBe('Bank');
    });
}

for (const remaining of ['arrows', 'none', 'nonfitting']) {
    test(`pending last-food corpse run finishes ${remaining} and returns before capacity banking`, async () => {
        const { bot, world, anchor, corpse, drop, run } = await lootScenario({ foodReserve: 26 });
        world.pack = [held(385), ...Array.from({ length: 26 }, () => held(1617)), held(892, 100)];
        drop(536);
        drop(1747);
        if (remaining === 'arrows') drop(892, undefined, 3);
        if (remaining === 'nonfitting') drop(1747);
        spyOn(EventSignal, 'pending').mockImplementation(() => world.events.some(e => e.action === 'Take' && e.id === 1747));
        await run(4);
        expect(world.here).toEqual(corpse);
        expect(world.pack).toHaveLength(28);
        spyOn(EventSignal, 'pending').mockReturnValue(false);

        await bot.loop();

        expect(world.here).toEqual(anchor);
        expect(world.events.some(e => e.action === 'Bank')).toBe(false);
        expect(world.events.filter(e => e.action === 'Take' && e.id === 892)).toHaveLength(remaining === 'arrows' ? 1 : 0);
        expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(1);
        await bot.loop();
        expect(world.events.at(-1)?.action).toBe('Bank');
    });
}

test('nonfitting-only corpse loot without food does not defer normal banking', async () => {
    const { bot, world, drop } = await lootScenario({ foodReserve: 27 });
    world.pack = [...Array.from({ length: 27 }, () => held(1617)), held(892, 100)];
    drop(536);
    drop(1747);

    await bot.loop();

    expect(world.events.map(e => e.action)).toEqual(['Bank']);
});

for (const shortage of ['food', 'ammo']) {
    test(`${shortage} supply banking still preempts a pending loot return`, async () => {
        const { bot, world, drop, run } = await lootScenario();
        drop(536);
        await run(3);
        if (shortage === 'food') {
            world.pack = [held(892, 100)];
            world.ground = world.ground.filter(item => item.id !== 385);
        }
        else {
            world.pack = world.pack.filter(item => item.id !== 892);
            spyOn(reader, 'equipment').mockReturnValue([]);
        }

        await bot.loop();

        expect(world.events.at(-1)?.action).toBe('Bank');
        expect(world.events.some(e => e.action === 'Take' && e.id === 385)).toBe(false);
    });
}

test('own dropped food survives an eight-pickup burst until remaining arrows finish', async () => {
    const { bot, world, anchor, drop, run } = await lootScenario();
    drop(536);
    for (let i = 0; i < 9; i++) drop(892, undefined, 1);
    await run(3);
    expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(1);

    await bot.loop();

    expect(world.events.filter(e => e.action === 'Take' && e.id === 892)).toHaveLength(8);
    expect(bot.lootRun?.food).toHaveLength(1);
    await bot.loop();
    expect(world.events.filter(e => e.action === 'Take' && e.id === 892)).toHaveLength(9);
    expect(world.events.filter(e => e.action === 'Take' && e.id === 385)).toHaveLength(1);
    expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(1);
    expect(world.here).toEqual(anchor);
    expect(bot.lootRun).toBeNull();
    await run(3);
    expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(1);
});
