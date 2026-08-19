import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, type InvItem } from '#/bot/api/inventory/Inventory.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import FlaxAIO from '#/bot/scripts/FlaxAIO/flaxaio.js';
import { AscendTask } from '#/bot/scripts/FlaxAIO/spinning.js';

const original = {
    delayUntil: Execution.delayUntil,
    ingame: Game.ingame,
    tile: Game.tile,
    isFull: Inventory.isFull,
    items: Inventory.items,
    stop: ScriptRunner.stop
};

let stops: string[];
let full: boolean;
let inv: { name: string; count: number }[];

function bot(picking = true, spinning = true): FlaxAIO {
    const instance = new FlaxAIO();
    instance.settings = new SettingsBag({ picking, spinning });
    return instance;
}

beforeEach(() => {
    stops = [];
    full = false;
    inv = [];
    Game.ingame = () => true;
    Game.tile = () => ({ x: 2725, z: 3493, level: 0 });
    Execution.delayUntil = async condition => condition();
    Inventory.isFull = () => full;
    Inventory.items = () => inv as unknown as InvItem[];
    ScriptRunner.stop = reason => {
        stops.push(reason);
    };
});

afterEach(() => {
    Execution.delayUntil = original.delayUntil;
    Game.ingame = original.ingame;
    Game.tile = original.tile;
    Inventory.isFull = original.isFull;
    Inventory.items = original.items;
    ScriptRunner.stop = original.stop;
});

describe('FlaxAIO startup', () => {
    test('stops when neither Pick nor Spin is enabled', async () => {
        await bot(false, false).onStart();
        expect(stops).toEqual(['FlaxAIO needs at least one of Pick or Spin enabled']);
    });

    test('starts when at least one mode is enabled', async () => {
        await bot(true, false).onStart();
        expect(stops).toEqual([]);
    });
});

describe('FlaxAIO banking decision', () => {
    test('both modes: banks bow strings on the ground floor, never mid-spin', async () => {
        const instance = bot(true, true);
        await instance.onStart();

        Game.tile = () => ({ x: 0, z: 0, level: 1 });
        expect(instance.needsBank()).toBe(false);

        Game.tile = () => ({ x: 0, z: 0, level: 0 });
        inv = [{ name: 'Bow string', count: 10 }];
        expect(instance.needsBank()).toBe(true);
    });

    test('pick-only: banks once the pack is full of flax', async () => {
        const instance = bot(true, false);
        await instance.onStart();

        inv = [{ name: 'Flax', count: 5 }];
        full = false;
        expect(instance.needsBank()).toBe(false);

        full = true;
        expect(instance.needsBank()).toBe(true);
    });

    test('spin-only: banks on the ground floor when out of flax to spin', async () => {
        const instance = bot(false, true);
        await instance.onStart();

        inv = [];
        expect(instance.needsBank()).toBe(true);

        inv = [{ name: 'Flax', count: 12 }];
        expect(instance.needsBank()).toBe(false);
    });
});

describe('FlaxAIO ascend decision', () => {
    test('both modes: only ascends once the pack is full of flax', async () => {
        const instance = bot(true, true);
        await instance.onStart();

        inv = [{ name: 'Flax', count: 10 }];
        full = false;
        expect(new AscendTask(instance).validate()).toBe(false);

        full = true;
        expect(new AscendTask(instance).validate()).toBe(true);
    });

    test('spin-only: ascends as soon as flax is in the pack', async () => {
        const instance = bot(false, true);
        await instance.onStart();

        inv = [{ name: 'Flax', count: 10 }];
        full = false;
        expect(new AscendTask(instance).validate()).toBe(true);
    });
});
