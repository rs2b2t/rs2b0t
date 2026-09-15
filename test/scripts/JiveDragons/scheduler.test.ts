import { afterEach, expect, test } from 'bun:test';
import { restoreScenario, scenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

for (const full of [false, true]) {
    test(`owned live dragon prevents arrow sweep with full=${full} and no self combat or face`, async () => {
        const { bot, fight, state } = await scenario();
        fight['setTarget'](17);
        state.full = full;
        await bot.loop();
        expect(state.takes).toBe(0);
        expect(state.drops).toBe(0);
        expect(bot.killsTotal).toBe(0);
    });
}

test('empty field completes the pending kill once before looting', async () => {
    const { bot, fight, state } = await scenario();
    fight['setTarget'](17);
    state.npcs = [];
    await bot.loop();
    expect(bot.killsTotal).toBe(1);
    expect(state.takes).toBe(0);
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(bot.killsTotal).toBe(1);
});

test('completion yields loot priority before another unowned dragon', async () => {
    const { bot, fight, state, dragon } = await scenario();
    fight['setTarget'](17);
    state.npcs = [{ ...dragon, index: 18, inCombat: false }];
    await bot.loop();
    expect(bot.killsTotal).toBe(1);
    expect(state.takes).toBe(0);
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(state.attacks).toBe(0);
});

for (const name of ['FreeSlot', 'LootCorpse']) {
    test(`${name} rechecks ownership after validation`, async () => {
        const { fight, state, task } = await scenario();
        state.full = name === 'FreeSlot';
        const selected = task(name);
        expect(await selected.validate()).toBe(true);
        fight['setTarget'](17);
        await selected.execute();
        expect(state.takes).toBe(0);
        expect(state.drops).toBe(0);
        expect(state.walks).toBe(0);
    });
}

test('abandonment is not death and only disappearance releases the live arrow hold', async () => {
    const { bot, fight, state, task } = await scenario();
    fight['setTarget'](17);
    fight['clearTarget']();
    await task('LootCorpse').execute();
    expect(state.takes).toBe(0);
    expect(bot.killsTotal).toBe(0);
    state.npcs = [];
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(bot.killsTotal).toBe(0);
});

test('a stale disappearance releases loot without counting a kill', async () => {
    const { bot, fight, state } = await scenario();
    fight['setTarget'](17);
    state.now += 10_000;
    state.npcs = [];
    await bot.loop();
    expect(bot.targetIdx).toBeNull();
    expect(bot.killsTotal).toBe(0);
    await bot.loop();
    expect(state.takes).toBe(1);
});

test('a leash outline is not owned combat and does not prevent old loot', async () => {
    const { bot, state } = await scenario();
    bot.targetIdx = 17;
    await bot.loop();
    expect(state.takes).toBe(1);
    expect(bot.killsTotal).toBe(0);
});
