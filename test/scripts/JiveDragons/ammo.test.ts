import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { held, lootScenario } from './loot.fixture.js';
import { restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

async function ammoScenario() {
    const fixture = await lootScenario({ foodReserve: 27 });
    const quiver = held(892, 1);
    const state = { confirmed: true, worn: [quiver] };
    const gear = fixture.task('GearEquip');
    spyOn(gear, 'validate').mockRestore();
    fixture.world.pack = [held(385), { ...held(892, 3), ops: ['Wield'] }, { ...held(890, 5), name: 'Mithril arrow', ops: ['Wield'] }];
    spyOn(reader, 'equipment').mockImplementation(() => state.worn);
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, action) {
        fixture.world.events.push({ action, id: this.id, tile: fixture.world.here });
        if (state.confirmed && action === 'Wield' && this.id === 892) {
            quiver.count += this.count;
            fixture.world.pack.splice(this.slot, 1);
        }
        return true;
    });
    return { ...fixture, gear, quiver, state };
}

test('worn Rune arrows merge only the configured Rune stack from a mixed pack', async () => {
    const { bot, world, quiver } = await ammoScenario();

    await bot.loop();

    expect(world.events.map(e => [e.action, e.id])).toEqual([['Wield', 892]]);
    expect(Inventory.count('Rune arrow')).toBe(0);
    expect(Inventory.count('Mithril arrow')).toBe(5);
    expect(quiver.count).toBe(4);
});

test('Mithril-only loot is never equipped for a Rune configuration', async () => {
    const { bot, world, quiver } = await ammoScenario();
    world.pack = world.pack.filter(item => item.id !== 892);

    await bot.loop();

    expect(world.events).toEqual([]);
    expect(quiver.count).toBe(1);
});

test('merging a configured stack frees a slot before capacity banking', async () => {
    const { world, run } = await ammoScenario();
    world.pack = [...Array.from({ length: 27 }, () => held(385)), { ...held(892, 3), ops: ['Wield'] }];

    await run(2);

    expect(world.events.map(e => e.action)).toEqual(['Wield']);
    expect(world.pack).toHaveLength(27);
});

test('configured arrows merge before reclaiming our Shark at the stand', async () => {
    const { bot, world, anchor, drop, task } = await ammoScenario();
    world.pack = [...Array.from({ length: 27 }, () => held(1747)), { ...held(892, 3), ops: ['Wield'] }];
    world.pack[0] = held(385);
    bot.lootRun = { food: [{ id: 385, tile: anchor }] };
    drop(385, anchor);
    const events = world.events;
    spyOn(GroundItem.prototype, 'interact').mockImplementation(() => {
        events.push({ action: 'Take', id: 385, tile: anchor });
        world.pack.push(held(385));
        world.ground = [];
        return true;
    });
    await task('LootCorpse').execute();

    expect(events.map(e => [e.action, e.id])).toEqual([['Wield', 892], ['Take', 385]]);
    expect(Inventory.count('Shark')).toBe(2);
    expect(world.pack).toHaveLength(28);
});

test('unconfirmed equip clicks stop retrying rather than reporting a merge', async () => {
    const { gear, state, world, quiver } = await ammoScenario();
    state.confirmed = false;

    for (let i = 0; i < 6; i++) if (gear.validate()) await gear.execute();

    expect(world.events.filter(e => e.action === 'Wield')).toHaveLength(5);
    expect(gear.validate()).toBe(false);
    expect(quiver.count).toBe(1);
    expect(Inventory.count('Rune arrow')).toBe(3);
});

test('last recoverable food permits configured ammo merge before return reclamation', async () => {
    const { bot, world, anchor, drop, task } = await ammoScenario();
    world.pack = [...Array.from({ length: 27 }, () => held(1747)), { ...held(892, 3), ops: ['Wield'] }];
    bot.lootRun = { food: [{ id: 385, tile: anchor }] };
    drop(385, anchor);
    spyOn(GroundItem.prototype, 'interact').mockImplementation(() => {
        world.events.push({ action: 'Take', id: 385, tile: anchor });
        world.pack.push(held(385));
        world.ground = [];
        return true;
    });

    await task('LootCorpse').execute();

    expect(world.events.map(e => [e.action, e.id])).toEqual([['Wield', 892], ['Take', 385]]);
    expect(Inventory.count('Shark')).toBe(1);
    expect(bot.lootRun).toBeNull();
});

for (const emergency of ['panic', 'no-food', 'eat', 'retreat']) {
    test(`${emergency} is not delayed by optional arrow merging`, async () => {
        const { bot, world, gear, task } = await ammoScenario();
        if (emergency === 'panic' || emergency === 'no-food') world.pack = world.pack.filter(item => item.id !== 385);
        if (emergency !== 'no-food') world.hp = emergency === 'panic' ? 10 : 40;
        const selected = emergency === 'panic' ? 'PanicBank' : emergency === 'no-food' ? 'BankRun' : emergency === 'eat' ? 'Eat' : 'Retreat';
        if (selected !== 'BankRun') spyOn(task(selected), 'validate').mockReturnValue(true);
        spyOn(task(selected), 'execute').mockImplementation(async () => { world.events.push({ action: selected, id: -1, tile: world.here }); });

        await bot.loop();

        expect(gear.validate()).toBe(false);
        expect(world.events.map(e => e.action)).toEqual([selected]);
    });
}
