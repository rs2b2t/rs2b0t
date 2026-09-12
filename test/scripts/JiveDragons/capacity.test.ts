import { afterEach, expect, spyOn } from 'bun:test';
import { test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { held, lootScenario } from './loot.fixture.js';
import { restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const count of [4, 2, 1]) {
    test(`full pack with ${count} food uses a food slot at or below reserve`, async () => {
        const { world, drop, run, anchor, bot } = await lootScenario();
        world.pack = [...Array.from({ length: count }, () => held(385)), ...Array.from({ length: 27 - count }, () => held(1617)), held(892, 100)];
        drop(536);
        drop(1747);

        await run(4);

        expect(world.events.slice(0, 4).map(event => event.action)).toEqual(['Drop', 'Take', 'Bury', 'Take']);
        expect(world.events.find(event => event.action === 'Drop')?.tile).toEqual(anchor);
        expect(bot.lootCounts.get('Dragonhide')).toBe(1);
        expect(world.here).toEqual(anchor);
    });
}

test('dangerous HP with food still permits the capacity escape', async () => {
    const { world, drop, run } = await lootScenario();
    world.pack = [held(385), ...Array.from({ length: 26 }, () => held(1617)), held(892, 100)];
    world.hp = 20;
    drop(536);

    await run(1);

    expect(world.events.map(event => event.action)).toEqual(['Bank']);
});

test('unavailable required ammo escapes before spending food', async () => {
    const { world, drop, run } = await lootScenario();
    world.pack = Array.from({ length: 28 }, () => held(385));
    spyOn(reader, 'equipment').mockReturnValue([]);
    drop(536);

    await run(1);

    expect(world.events.map(event => event.action)).toEqual(['Bank']);
});

test('last food is reclaimed after bones burial instead of premature banking', async () => {
    const { world, drop, run, anchor } = await lootScenario();
    world.pack = [held(385), ...Array.from({ length: 26 }, () => held(1617)), held(892, 100)];
    drop(536);

    await run(5);

    expect(world.events.map(event => [event.action, event.id])).toEqual([['Drop', 385], ['Take', 536], ['Bury', 536], ['Walk', -1], ['Take', 385]]);
    expect(world.here).toEqual(anchor);
});

test('eating the last food for capacity completes pickup and return before banking', async () => {
    const { world, drop, run, anchor } = await lootScenario();
    world.pack = [held(385), ...Array.from({ length: 26 }, () => held(1617)), held(892, 100)];
    world.hp = 98;
    drop(1747);

    await run(3);

    expect(world.events.map(event => event.action)).toEqual(['Eat', 'Take', 'Walk', 'Bank']);
    expect(world.here).toEqual(anchor);
});

test('wrong looted ammo stays in a full pack while a food slot is used', async () => {
    const { world, drop, run, task } = await lootScenario();
    world.pack = [held(385), ...Array.from({ length: 26 }, () => held(1617)), { ...held(890), name: 'Mithril arrow', ops: ['Wield'] }];
    spyOn(task('GearEquip'), 'validate').mockRestore();
    drop(1747);

    await run(1);

    expect(world.events.map(event => [event.action, event.id])).toEqual([['Drop', 385]]);
    expect(world.pack.some(item => item.id === 890)).toBe(true);
});
