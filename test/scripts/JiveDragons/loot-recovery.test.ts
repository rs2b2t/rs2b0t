import { afterEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { held, lootScenario } from './loot.fixture.js';
import { restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

async function lastFoodReturn() {
    const fixture = await lootScenario();
    fixture.world.pack.splice(1, 26, ...Array.from({ length: 26 }, () => held(1747)));
    fixture.drop(536);
    await fixture.run(3);
    return fixture;
}

test('retains the last Shark through a failed return and reclaims it before banking', async () => {
    const { bot, world, task, run } = await lastFoodReturn();
    world.rejectWalk = true;
    await run(1);
    expect(bot.lootRun?.food).toHaveLength(1);
    expect(task('BankRun').validate()).toBe(false);
    world.rejectWalk = false;
    await run(2);
    expect(world.events.filter(e => e.action === 'Take').map(e => e.id)).toEqual([536, 385]);
    expect(world.events.some(e => e.action === 'Bank')).toBe(false);
    expect(bot.lootRun).toBeNull();
});

test('retains recovery when an event interrupts the return then resumes after the event', async () => {
    const { bot, world, anchor, run } = await lastFoodReturn();
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => {
        world.here = anchor;
        spyOn(EventSignal, 'pending').mockReturnValue(true);
        return true;
    });
    await run(1);
    expect(bot.lootRun?.food).toHaveLength(1);
    expect(world.events.filter(e => e.action === 'Take').map(e => e.id)).toEqual([536]);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    await run(2);
    expect(world.pack.filter(item => item.id === 385)).toHaveLength(1);
    expect(world.events.some(e => e.action === 'Bank')).toBe(false);
});

test('a refused own-food Take retains the ledger for a successful retry', async () => {
    const { bot, world, task, run } = await lastFoodReturn();
    world.rejectTake = true;
    await run(1);
    expect(bot.lootRun?.food).toHaveLength(1);
    expect(task('BankRun').validate()).toBe(false);
    world.rejectTake = false;
    await run(2);
    expect(world.pack.filter(item => item.id === 385)).toHaveLength(1);
    expect(world.events.some(e => e.action === 'Bank')).toBe(false);
});

for (const refusal of ['rejectWalk', 'rejectTake'] as const) {
    test(`abandons recovery after the existing five-attempt budget when ${refusal} persists`, async () => {
        const { bot, world, task, run } = await lastFoodReturn();
        world[refusal] = true;
        await run(4);
        expect(bot.lootRun?.food).toHaveLength(1);
        await run(1);
        expect(bot.lootRun).toBeNull();
        expect(task('BankRun').validate()).toBe(true);
    });
}

test('exhausted burial returns a full last-food run then yields to banking', async () => {
    const { bot, world, anchor, drop, run, task } = await lootScenario();
    world.pack.splice(1, 26, ...Array.from({ length: 26 }, () => held(1747)));
    world.rejectBury = true;
    drop(536);
    await run(7);
    expect(world.events.filter(e => e.action === 'Bury')).toHaveLength(5);
    expect(task('BuryBones').validate()).toBe(false);
    await run(1);
    expect(world.here).toEqual(anchor);
    expect(bot.lootRun).toBeNull();
    expect(task('LootCorpse').validate()).toBe(false);
    expect(task('BankRun').validate()).toBe(true);
    await run(1);
    expect(world.events.filter(e => e.action === 'Bank')).toHaveLength(1);
});

test('burial cooldown permits fitting loot without taking more bones and later resumes burial', async () => {
    const { bot, world, drop, run, task } = await lootScenario();
    let now = 10_000;
    spyOn(Date, 'now').mockImplementation(() => now);
    world.rejectBury = true;
    drop(536);
    await run(7);
    drop(536);
    drop(892, undefined, 3);
    await run(2);
    expect(world.events.filter(e => e.action === 'Take').map(e => e.id)).toEqual([536, 892]);
    expect(task('FreeSlot').validate()).toBe(false);
    expect(task('LootCorpse').validate()).toBe(false);
    world.rejectBury = false;
    now += 60_001;
    await run(4);
    expect(bot.buried).toBe(2);
    expect(world.events.filter(e => e.action === 'Take' && e.id === 536)).toHaveLength(2);
});

test('burial exhaustion can reclaim the last Shark when another slot becomes available', async () => {
    const { bot, world, drop, run } = await lootScenario();
    world.pack.splice(1, 26, ...Array.from({ length: 26 }, () => held(1747)));
    world.rejectBury = true;
    drop(536);
    await run(7);
    world.pack.splice(0, 1);
    await run(2);
    expect(world.pack.filter(item => item.id === 385)).toHaveLength(1);
    expect(world.events.some(e => e.action === 'Bank')).toBe(false);
    expect(bot.lootRun).toBeNull();
});
