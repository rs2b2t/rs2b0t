import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { SHOP_DB } from '#/bot/data/shopdb.js';
import * as steps from '#/bot/api/ai/quests/exec/steps.js';
import { acquireRedberries } from '#/bot/api/ai/quests/defs/goblindiplomacy/redberries.js';

let held = 0;
let ticks = 0;
let stopAt = Infinity;
let full = false;
let stock = 1;
let restock = true;
const spies: { mockRestore(): void }[] = [];
const quantities: number[] = [];

beforeEach(() => {
    held = 0;
    ticks = 0;
    stopAt = Infinity;
    full = false;
    stock = 1;
    restock = true;
    quantities.length = 0;
    spies.push(spyOn(Inventory, 'count').mockImplementation(name => name === 'Redberries' ? held : 1000));
    spies.push(spyOn(Inventory, 'isFull').mockImplementation(() => full));
    spies.push(spyOn(EventSignal, 'pending').mockImplementation(() => ticks >= stopAt));
    spies.push(spyOn(Sustain, 'run').mockResolvedValue(undefined));
    spies.push(spyOn(Execution, 'delayTicks').mockImplementation(async count => {
        const next = ticks + count;
        if (restock && Math.floor(next / 100) > Math.floor(ticks / 100)) stock = 1;
        ticks = next;
    }));
    spies.push(spyOn(steps, 'executeStep').mockImplementation(async step => {
        expect(step.kind).toBe('buy');
        if (step.kind !== 'buy') return false;
        expect(step.item).toBe('Redberries');
        expect(step.shop.npc).toBe('Wydin');
        quantities.push(step.qty);
        const bought = Math.min(stock, step.qty);
        stock -= bought;
        held += bought;
        return bought > 0;
    }));
});

afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore();
});

test('collects all three across Wydin restocks before returning to the engine', async () => {
    const berries = SHOP_DB.wydinstore.items.find(item => item.name === 'Redberries');
    expect(berries?.baseline).toBe(1);
    expect(berries?.restockTicks).toBe(100);
    expect(await acquireRedberries(() => {})).toBe(true);
    expect(held).toBe(3);
    expect(quantities).toEqual([3, 2, 1]);
    expect(ticks).toBe(200);
    expect(Sustain.run).toHaveBeenCalled();
});

test('buys only the missing berry and skips waits when already stocked', async () => {
    held = 2;
    expect(await acquireRedberries(() => {})).toBe(true);
    expect(quantities).toEqual([1]);
    expect(ticks).toBe(0);
    expect(await acquireRedberries(() => {})).toBe(true);
    expect(quantities).toEqual([1]);
});

test('caps an empty shared shop at three restock waits', async () => {
    stock = 0;
    restock = false;
    expect(await acquireRedberries(() => {})).toBe(false);
    expect(quantities).toEqual([3, 3, 3, 3]);
    expect(ticks).toBe(300);
});

test('reports real partial acquisition when other shoppers exhaust later restocks', async () => {
    restock = false;
    expect(await acquireRedberries(() => {})).toBe(true);
    expect(held).toBe(1);
    expect(quantities).toEqual([3, 2, 2, 2]);
    expect(ticks).toBe(300);
});

test('yields during a restock wait when interrupted', async () => {
    stock = 0;
    stopAt = 7;
    expect(await acquireRedberries(() => {})).toBe(false);
    expect(ticks).toBe(7);
    expect(quantities).toEqual([3]);
});

test('does not buy or wait when interrupted before starting', async () => {
    stopAt = 0;
    expect(await acquireRedberries(() => {})).toBe(false);
    expect(quantities).toEqual([]);
    expect(ticks).toBe(0);
});

test('does not wait for shop stock when the inventory is full', async () => {
    full = true;
    expect(await acquireRedberries(() => {})).toBe(false);
    expect(quantities).toEqual([]);
    expect(ticks).toBe(0);
});

test('propagates a stop thrown by sustain', async () => {
    const stopped = new Error('script stopped');
    spyOn(Sustain, 'run').mockRejectedValue(stopped);
    await expect(acquireRedberries(() => {})).rejects.toBe(stopped);
    expect(quantities).toHaveLength(1);
});
