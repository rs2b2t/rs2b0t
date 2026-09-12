import { afterEach, expect, spyOn, test } from 'bun:test';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { held, lootScenario } from './loot.fixture.js';
import { restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

test('full food with nearest stack-fitting ammo still frees a slot for bones', async () => {
    const { world, anchor, drop, run } = await lootScenario();
    drop(892, anchor, 3);
    drop(536);
    drop(1747);
    await run();
    expect(world.events.filter(e => e.action !== 'Walk').map(e => [e.action, e.id])).toEqual([
        ['Drop', 385], ['Take', 536], ['Bury', 536], ['Take', 1747], ['Take', 892]
    ]);
    expect(world.events.find(e => e.action === 'Drop')?.tile).toEqual(anchor);
    expect(world.here).toEqual(anchor);
    expect(world.pack.filter(item => item.id === 385)).toHaveLength(26);
});

for (const count of [1, 100]) {
    test(`a full pack accepts arrows into a held stack of ${count} without dropping food`, async () => {
        const { world, drop, run } = await lootScenario();
        world.pack[27] = held(892, count);
        drop(892, undefined, 3);
        await run();
        expect(world.events.filter(e => e.action !== 'Walk').map(e => e.action)).toEqual(['Take']);
        expect(world.pack.find(item => item.id === 892)?.count).toBe(count + 3);
    });
}

test('a live owned dragon with a full food pack allows neither slot drops nor pickups', async () => {
    const { bot, state, dragon, engage, world, drop } = await lootScenario();
    state.npcs = [dragon];
    await engage();
    drop(536);
    drop(892);
    await bot.loop();
    expect(world.events).toEqual([]);
    expect(bot.killsTotal).toBe(0);
});

test('completion with 28 Sharks drops at the anchor then buries before hide and other loot', async () => {
    const { bot, state, dragon, engage, world, anchor, drop, run } = await lootScenario();
    world.pack[27] = held(385);
    state.npcs = [dragon];
    await engage();
    state.npcs = [];
    drop(536);
    drop(1747);
    drop(995, undefined, 50);
    await run();
    expect(bot.killsTotal).toBe(1);
    expect(world.events.filter(e => e.action !== 'Walk').map(e => [e.action, e.id])).toEqual([
        ['Drop', 385], ['Take', 536], ['Bury', 536], ['Take', 1747], ['Drop', 385], ['Take', 995]
    ]);
    expect(world.events.filter(e => e.action === 'Drop').every(e => e.tile.equals(anchor))).toBe(true);
    expect(world.here).toEqual(anchor);
});

test('a bones-only trip reclaims just its own Shark after burial leaves a slot', async () => {
    const { world, anchor, corpse, drop, run } = await lootScenario();
    drop(385, corpse);
    drop(536);
    await run();
    expect(world.events.filter(e => e.action !== 'Walk').map(e => [e.action, e.id])).toEqual([
        ['Drop', 385], ['Take', 536], ['Bury', 536], ['Take', 385]
    ]);
    expect(world.events.findLast(e => e.action === 'Take')?.tile).toEqual(anchor);
    expect(world.ground.filter(item => item.id === 385)).toHaveLength(1);
    expect(world.pack).toHaveLength(28);
});

test('preexisting Sharks at the anchor are never claimed as our dropped food', async () => {
    const { world, anchor, drop, run } = await lootScenario();
    drop(385, anchor);
    drop(536);
    await run();
    expect(world.events.some(e => e.action === 'Take' && e.id === 385)).toBe(false);
});

test('a finished full return forgets the Shark even if a slot becomes free later', async () => {
    const { world, drop, run } = await lootScenario();
    drop(536);
    drop(1747);
    await run();
    world.pack.pop();
    await run();
    expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(1);
    expect(world.events.some(e => e.action === 'Take' && e.id === 385)).toBe(false);
});

test('extra slot preparation returns from the corpse before each food drop', async () => {
    const { world, anchor, corpse, drop, run } = await lootScenario();
    world.here = corpse;
    drop(536);
    drop(1747);
    drop(1617);
    await run();
    expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(2);
    expect(world.events.filter(e => e.action === 'Drop').every(e => e.tile.equals(anchor))).toBe(true);
    expect(world.here).toEqual(anchor);
});

test('wounded slot preparation eats first instead of dropping food', async () => {
    const { world, drop, run } = await lootScenario();
    world.hp = 95;
    drop(536);
    await run();
    expect(world.events.filter(e => e.action !== 'Walk').map(e => e.action)).toEqual(['Eat', 'Take', 'Bury']);
});

test('safe corpse loot may use food at the configured reserve', async () => {
    const { world, drop, run } = await lootScenario({ foodReserve: 27 });
    drop(536);
    await run(2);
    expect(world.events.map(e => e.action)).toEqual(['Drop', 'Take']);
    expect(world.pack.filter(item => item.id === 385)).toHaveLength(26);
});

test('BURY false and common loot disabled retain only explicitly selected drops', async () => {
    const { world, drop, run } = await lootScenario({ buryBones: false, bankCommonJunk: false, lootBlack: ['Dragonhide'] });
    drop(536);
    drop(1747);
    drop(1617);
    await run();
    expect(world.events.filter(e => e.action === 'Take').map(e => e.id)).toEqual([1747]);
    expect(world.events.some(e => e.action === 'Bury')).toBe(false);
});

test('an engagement acquired during the return prevents the pending food drop', async () => {
    const { bot, state, dragon, engage, world, anchor, corpse, drop } = await lootScenario();
    world.here = corpse;
    drop(536);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        world.here = anchor;
        state.npcs = [dragon];
        await engage();
        return true;
    });
    await bot.loop();
    expect(world.events).toEqual([]);
});

test('an engagement acquired while returning after burial prevents Shark reclaim', async () => {
    const { bot, state, dragon, engage, world, anchor, drop, run } = await lootScenario();
    drop(536);
    await run(3);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        world.here = anchor;
        state.npcs = [dragon];
        await engage();
        return true;
    });
    await bot.loop();
    expect(world.events.some(e => e.action === 'Take' && e.id === 385)).toBe(false);
});

test('failed pickup is bounded and does not repeatedly drop and reclaim food', async () => {
    const { world, anchor, drop, run } = await lootScenario();
    world.rejectTake = true;
    drop(536);
    await run(20);
    expect(world.events.filter(e => e.action === 'Drop')).toHaveLength(1);
    expect(world.here).toEqual(anchor);
});

test('an unreachable anchor never permits dropping food at the corpse', async () => {
    const { world, corpse, drop, run } = await lootScenario();
    world.here = corpse;
    world.rejectWalk = true;
    drop(536);
    await run(2);
    expect(world.events.every(e => e.action === 'Walk')).toBe(true);
    expect(world.pack).toHaveLength(28);
});

test('food names remain case-insensitive and reclaim uses the actual dropped item id', async () => {
    const { world, drop, run } = await lootScenario();
    for (const item of world.pack) if (item.id === 385) item.name = 'SHARK';
    drop(536);
    await run();
    expect(world.events.filter(e => e.action === 'Take').map(e => e.id)).toEqual([536, 385]);
});

test('low health prevents all optional slot preparation and loot movement', async () => {
    const { world, drop, run } = await lootScenario();
    world.hp = 30;
    drop(536);
    await run(2);
    expect(world.events).toEqual([]);
});
