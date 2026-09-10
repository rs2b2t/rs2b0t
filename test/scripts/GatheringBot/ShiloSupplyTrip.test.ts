import { afterEach, expect, mock, test } from 'bun:test';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Gather } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';
import { shiloFixture } from './ShiloTripFixture.js';

afterEach(() => mock.restore());

for (const failure of ['openOk', 'depositOk'] as const) {
    test(`latches the outbound bank trip when partial-pack ${failure} fails`, async () => {
        const { bot, state, task, run } = shiloFixture();
        state.pack.set('Raw trout', 1);
        state[failure] = false;
        expect(Inventory.isFull()).toBe(false);
        expect(task.validate()).toBe(true);
        await task.execute();
        expect(bot.guildFeatherTripDue()).toBe(false);
        expect(task.validate()).toBe(true);
        expect(new Gather(bot).validate()).toBe(false);
        expect(state.shoppingPacks).toEqual([]);
        expect(state.events.filter(event => event === 'bank')).toHaveLength(1);
        state[failure] = true;
        await run();
        expect(state.shoppingPacks).toEqual([
            ['Coins', 'Fly fishing rod', 'Feather'], ['Coins', 'Fly fishing rod', 'Feather']
        ]);
        expect(state.events.at(-1)).toBe('home');
        expect(task.validate()).toBe(false);
        expect(new Gather(bot).validate()).toBe(true);
    });
}

test('accepts a due Shilo trip when the funded backpack is full', () => {
    const { task } = shiloFixture();
    expect(Inventory.isFull()).toBe(true);
    expect(task.validate()).toBe(true);
});

test('banks fish and acquisition junk before both shops when coins are already held', async () => {
    const { state, run } = shiloFixture();
    await run();
    expect(state.events).toEqual(['bank', 'deposit', 'Fernahei', 'Obli', 'bank', 'deposit', 'home']);
    expect(state.shoppingPacks).toEqual([
        ['Coins', 'Fly fishing rod', 'Feather'], ['Coins', 'Fly fishing rod', 'Feather']
    ]);
    expect(state.pack.has('Vial of water')).toBe(false);
    expect(state.purchases).toEqual([{ name: 'Feather', qty: 800 }, { name: 'Vial of water', qty: 25 }]);
});

for (const failure of ['openOk', 'ready', 'depositOk', 'closeOk'] as const) {
    test(`never shops when initial bank ${failure} is false`, async () => {
        const { state, run } = shiloFixture();
        state.pack.set('Raw trout', 1);
        state[failure] = false;
        await run();
        expect(state.shoppingPacks).toEqual([]);
    });
}

test('blocks fishing and retries only the bank when final vial deposit fails', async () => {
    const { bot, state, task } = shiloFixture();
    state.pack.set('Raw trout', 1);
    state.vialStock = 2;
    for (let leg = 0; leg < 3; leg++) await task.execute();
    state.depositOk = false;
    await task.execute();
    expect(state.pack.get('Vial of water')).toBe(2);
    expect(bot.guildFeatherTripDue()).toBe(false);
    expect(task.validate()).toBe(true);
    expect(new Gather(bot).validate()).toBe(false);
    await task.execute();
    expect(state.shoppingPacks).toHaveLength(2);
    state.depositOk = true;
    await task.execute();
    await task.execute();
    expect(task.validate()).toBe(false);
    expect(new Gather(bot).validate()).toBe(true);
});

for (const missing of ['zero', 'absent'] as const) {
    test(`resumes without restock waiting when water vial stock is ${missing}`, async () => {
        const { state, task, run } = shiloFixture();
        state.pack.set('Raw trout', 1);
        state.vialStock = 0;
        state.vialListed = missing !== 'absent';
        await run();
        expect(state.purchases.filter(purchase => purchase.name === 'Vial of water')).toEqual([]);
        expect(state.events.filter(event => event === 'Obli')).toHaveLength(1);
        expect(state.events.at(-1)).toBe('home');
        expect(task.validate()).toBe(false);
    });
}

test('gives feathers priority and respects their rising unit prices when poor', async () => {
    const { state, run } = shiloFixture();
    state.pack.set('Raw trout', 1);
    state.pack.set('Coins', 10);
    state.bankCoins = 0;
    state.featherStock = 1;
    await run();
    expect(state.purchases).toEqual([{ name: 'Vial of water', qty: 3 }]);
});

test('leaves non Shilo full-pack eligibility unchanged', () => {
    const { task } = shiloFixture('Fishing Guild');
    expect(task.validate()).toBe(false);
});

test('reserves worst-case vial prices for only the slots available after banking', async () => {
    const { state, run } = shiloFixture();
    state.pack.delete('Coins');
    await run();
    expect(state.drawn).toBe(8325);
    expect(state.purchases).toEqual([{ name: 'Feather', qty: 800 }, { name: 'Vial of water', qty: 25 }]);
});

test('buys and banks all 25 available vials after buying 800 feathers with banked coins', async () => {
    const { state, run } = shiloFixture();
    state.pack.delete('Coins');
    state.vialStock = 25;
    await run();
    expect(state.purchases).toEqual([{ name: 'Feather', qty: 800 }, { name: 'Vial of water', qty: 25 }]);
    expect(state.deposited.get('Vial of water')).toBe(25);
    expect(state.pack.has('Vial of water')).toBe(false);
});

test('spends a small shared budget on feathers before optional water vials', async () => {
    const { state, run } = shiloFixture();
    state.pack.set('Coins', 10);
    state.bankCoins = 0;
    await run();
    expect(state.purchases).toEqual([{ name: 'Feather', qty: 5 }]);
});

test('buys no supplies when neither held nor banked coins can cover a unit', async () => {
    const { state, task, run } = shiloFixture();
    state.pack.set('Coins', 1);
    state.bankCoins = 0;
    await run();
    expect(state.purchases).toEqual([]);
    expect(task.validate()).toBe(false);
});

test('resumes without retrying empty feather and vial shelves', async () => {
    const { state, task, run } = shiloFixture();
    state.featherStock = 0;
    state.vialStock = 0;
    await run();
    expect(state.purchases).toEqual([]);
    expect(state.events.at(-1)).toBe('home');
    expect(task.validate()).toBe(false);
});

test('keeps the bank return latched when the final bank cannot close', async () => {
    const { bot, state, task } = shiloFixture();
    for (let leg = 0; leg < 3; leg++) await task.execute();
    state.closeOk = false;
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(new Gather(bot).validate()).toBe(false);
});

test('never treats an unloaded side backpack as confirmed empty after depositing', async () => {
    const { state, run } = shiloFixture();
    state.loseSnapshotOnDeposit = true;
    await run();
    expect(state.shoppingPacks).toEqual([]);
});

test('keeps fishing blocked when the final bank cannot open', async () => {
    const { bot, state, task } = shiloFixture();
    for (let leg = 0; leg < 3; leg++) await task.execute();
    state.openOk = false;
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(new Gather(bot).validate()).toBe(false);
});

test('does not add a supply trip at the funded Fishing Guild camp', async () => {
    const { state, task, run } = shiloFixture('Fishing Guild');
    state.pack.set('Raw trout', 1);
    await run();
    expect(task.validate()).toBe(false);
    expect(state.events).toEqual([]);
});
