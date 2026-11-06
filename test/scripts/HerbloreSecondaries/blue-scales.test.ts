import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import * as doors from '#/bot/api/ai/quests/exec/prompts.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import HerbloreSecondaries from '#/bot/scripts/HerbloreSecondaries/HerbloreSecondaries.js';

afterEach(() => { mock.restore(); Sustain.set(null); });

async function setup(foodWithdraw = 10) {
    const pack = new Map<string, number>([['Lobster', 10], ['Dusty key', 1]]);
    const stock = new Map<string, number>([['Lobster', 50], ['Dusty key', 1], ['Dragonfire shield', 1]]);
    const state = { tile: new Tile(2946, 3369, 0), shield: true, open: false, stops: [] as string[], walks: [] as Tile[] };
    const ids: Record<string, number> = { 'Blue dragon scale': 243, Lobster: 379, 'Dusty key': 1590, 'Dragonfire shield': 1540 };
    const snapshots = (): InvItemSnapshot[] => [...pack].flatMap(([name, count]) =>
        Array.from({ length: count }, () => ({ name, count: 1, id: ids[name]!, slot: 0, comId: 3214, ops: ['Use', 'Drop'] })))
        .map((item, slot) => ({ ...item, slot }));
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(snapshots);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(Loadouts, 'all').mockReturnValue([]);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Equipment, 'contains').mockImplementation(name => name === 'Dragonfire shield' && state.shield);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => {
        state.walks.push(Tile.from(tile));
        state.tile = Tile.from(tile);
        return true;
    });
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'openNearest').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Bank, 'count').mockImplementation(name => stock.get(name) ?? 0);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        for (const [name, count] of pack) {
            if (!predicate(name, ids[name]!)) continue;
            stock.set(name, (stock.get(name) ?? 0) + count);
            pack.delete(name);
        }
    });
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        const qty = Math.min(count, stock.get(name) ?? 0, Inventory.free());
        stock.set(name, (stock.get(name) ?? 0) - qty);
        if (qty > 0) pack.set(name, (pack.get(name) ?? 0) + qty);
        return qty > 0;
    });
    spyOn(ScriptRunner, 'stop').mockImplementation(reason => { state.stops.push(reason ?? ''); });
    const bot = new HerbloreSecondaries();
    bot.settings = new SettingsBag({ secondary: 'Blue dragon scale', foodWithdraw });
    bot.bindLog(() => {});
    await bot.onStart();
    return { bot, pack, stock, state, bank: bot['tasks'].find(task => task.constructor.name === 'BankTrip')! };
}

test('a missing Dusty key triggers banking before the collection trip', async () => {
    const { bank, pack, state } = await setup();
    pack.delete('Dusty key');
    expect(bank.validate()).toBe(true);
    await bank.execute();
    expect(Inventory.count('Dusty key')).toBe(1);
    expect(bank.validate()).toBe(false);
    expect(state.stops).toEqual([]);
});

test('an inherited pack full of food leaves room for the key, shield, and scales', async () => {
    const { bank, pack, state } = await setup(27);
    pack.delete('Dusty key');
    pack.set('Lobster', 28);
    state.shield = false;
    await bank.execute();
    expect(Inventory.count('Dusty key')).toBe(1);
    expect(Inventory.count('Dragonfire shield')).toBe(1);
    expect(Inventory.free()).toBeGreaterThanOrEqual(1);
    expect(state.stops).toEqual([]);
});

test('banking a full scale load preserves the key and restocks food', async () => {
    const { bank, pack, stock } = await setup();
    pack.set('Blue dragon scale', 19);
    pack.set('Lobster', 8);
    expect(bank.validate()).toBe(true);
    await bank.execute();
    expect(pack.has('Blue dragon scale')).toBe(false);
    expect(stock.get('Blue dragon scale')).toBe(19);
    expect(pack.get('Dusty key')).toBe(1);
    expect(pack.get('Lobster')).toBe(10);
    expect(bank.validate()).toBe(false);
});

for (const name of ['Dusty key', 'Dragonfire shield']) {
    test(`missing ${name} stops at the bank before entering the dungeon`, async () => {
        const { bank, pack, stock, state } = await setup();
        pack.delete(name);
        stock.delete(name);
        if (name === 'Dragonfire shield') state.shield = false;
        expect(bank.validate()).toBe(true);
        await bank.execute();
        expect(state.stops).toEqual([`no ${name} banked for Blue dragon scale`]);
        expect(state.open).toBe(false);
        expect(state.walks).toEqual([]);
    });
}

test('the outbound walk unlocks the gate before walking to the scale spawns', async () => {
    const { bot, state } = await setup();
    const crossing = spyOn(doors, 'crossTeleportDoor').mockImplementation(async door => {
        expect(door.id).toBe(2623);
        expect(door.useItem).toBe(1590);
        expect(door.stand).toMatchObject({ x: 2924, z: 9803 });
        expect(door.standRadius).toBe(0);
        expect(door.isFar()).toBe(false);
        state.tile = new Tile(2923, 9803, 0);
        expect(door.isFar()).toBe(true);
        return true;
    });
    expect(await bot.walkTo(bot.site().anchor, 'scales')).toBe(true);
    expect(crossing).toHaveBeenCalledTimes(1);
    expect(state.tile).toMatchObject({ x: 2906, z: 9804, level: 0 });
});

test('the return walk opens the gate from inside even without a key', async () => {
    const { bot, state, pack } = await setup();
    state.tile = new Tile(2906, 9804, 0);
    pack.delete('Dusty key');
    const crossing = spyOn(doors, 'crossTeleportDoor').mockImplementation(async door => {
        expect(door.useItem).toBeUndefined();
        expect(door.stand).toMatchObject({ x: 2923, z: 9803 });
        expect(door.standRadius).toBe(1);
        expect(door.isFar()).toBe(false);
        state.tile = new Tile(2924, 9803, 0);
        expect(door.isFar()).toBe(true);
        return true;
    });
    expect(await bot.walkTo(bot.site().bank, 'bank')).toBe(true);
    expect(crossing).toHaveBeenCalledTimes(1);
    expect(state.tile).toMatchObject({ x: 2946, z: 3369, level: 0 });
});

test('a failed gate crossing never starts a walk into the sealed room', async () => {
    const { bot, state } = await setup();
    spyOn(doors, 'crossTeleportDoor').mockResolvedValue(false);
    expect(await bot.walkTo(bot.site().anchor, 'scales')).toBe(false);
    expect(state.walks).toEqual([]);
});

test('collects raw scales from the dungeon floor and counts the pickup', async () => {
    const { bot, state, pack } = await setup();
    state.tile = new Tile(2906, 9804, 0);
    spyOn(reader, 'groundItems').mockReturnValue([
        { id: 243, name: 'Blue dragon scale', count: 1, tile: { x: 2908, z: 9805, level: 0 }, distance: 2, ops: [null, null, 'Take', null, null] }
    ]);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 28, lz: 13 });
    spyOn(Input, 'takeObj').mockImplementation((x, z, id, op) => {
        expect([x, z, id, op]).toEqual([28, 13, 243, 3]);
        pack.set('Blue dragon scale', 1);
        return true;
    });
    const loot = bot['tasks'].find(task => task.constructor.name === 'Loot')!;
    expect(loot.validate()).toBe(true);
    await loot.execute();
    expect(bot.productCount()).toBe(1);
    expect(bot['gathered']).toBe(1);
    expect(Inventory.count('Dragon scale dust')).toBe(0);
});
