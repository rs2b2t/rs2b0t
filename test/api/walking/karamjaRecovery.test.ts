import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { reader, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import * as primitives from '#/bot/api/ai/quests/exec/primitives.js';
import * as karamja from '#/bot/api/ai/quests/defs/piratestreasure/karamja.js';

const dock = { x: 2772, z: 3235, level: 0 };
const mainland = { x: 3093, z: 3243, level: 0 };
let here: WorldTile;
let coins: number;

beforeEach(() => {
    here = dock;
    coins = 0;
    spyOn(reader, 'worldTile').mockImplementation(() => here);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 995 ? coins : 0);
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(WalkExecutor, 'walkTo').mockImplementation(async dest => {
        if (dest === mainland && coins < 30) {
            WalkExecutor.lastOutcome = 'failed';
            WalkExecutor.lastMissingGateItems = [{ name: 'Coins', count: 30 - coins }];
            return false;
        }
        here = dest;
        WalkExecutor.lastOutcome = 'arrived';
        WalkExecutor.lastMissingGateItems = [];
        return true;
    });
});

afterEach(() => {
    mock.restore();
    WalkExecutor.lastOutcome = null;
    WalkExecutor.lastMissingGateItems = [];
});

describe('walking home without a Karamja boat fare', () => {
    test('collects a completed crate payment and retries the original destination', async () => {
        const talk = spyOn(primitives, 'talkStrict').mockImplementation(async () => {
            coins += 30;
            return true;
        });
        expect(await Traversal.walkTo(mainland)).toBe(true);
        expect(talk).toHaveBeenCalledTimes(1);
        expect(talk.mock.calls[0]?.[0]).toBe('Luthas');
        expect(here).toEqual(mainland);
    });

    test('keeps an already affordable route', async () => {
        coins = 30;
        const talk = spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        expect(await Traversal.walkTo(mainland)).toBe(true);
        expect(talk).not.toHaveBeenCalled();
    });

    test('earns a fare from an empty pack before retrying a resilient walk', async () => {
        let filled = false;
        const fill = spyOn(karamja, 'fillCrate').mockImplementation(async () => {
            filled = true;
            return true;
        });
        const talk = spyOn(primitives, 'talkStrict').mockImplementation(async () => {
            if (filled) coins += 30;
            return true;
        });
        expect(await Traversal.walkResilient(mainland, { radius: 2, attempts: 2 })).toBe(true);
        expect(talk).toHaveBeenCalledTimes(2);
        expect(fill).toHaveBeenCalledTimes(1);
        expect(here).toEqual(mainland);
    });

    test('preserves the missing fare when the plantation cannot fill the crate', async () => {
        spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        spyOn(karamja, 'fillCrate').mockResolvedValue(false);
        expect(await Traversal.walkTo(mainland)).toBe(false);
        expect(WalkExecutor.lastOutcome).toBe('failed');
        expect(WalkExecutor.lastMissingGateItems).toEqual([{ name: 'Coins', count: 30 }]);
    });

    test('does not recursively recover a failed walk during the job', async () => {
        const talk = spyOn(primitives, 'talkStrict').mockImplementation(() => Traversal.walkTo(mainland));
        expect(await Traversal.walkTo(mainland)).toBe(false);
        expect(talk).toHaveBeenCalledTimes(1);
    });

    test('keeps an available teleport route before earning coins', async () => {
        spyOn(WalkExecutor, 'walkTo').mockResolvedValue(true);
        const talk = spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        expect(await Traversal.walkTo(mainland)).toBe(true);
        expect(talk).not.toHaveBeenCalled();
    });

    test('does not discard a full inventory to make room for bananas', async () => {
        spyOn(Inventory, 'isFull').mockReturnValue(true);
        const talk = spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        expect(await Traversal.walkTo(mainland)).toBe(false);
        expect(talk).not.toHaveBeenCalled();
    });

    test('does not earn coins when the same failure happens on the mainland', async () => {
        here = { x: 3008, z: 3200, level: 0 };
        const talk = spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        expect(await Traversal.walkTo(mainland)).toBe(false);
        expect(talk).not.toHaveBeenCalled();
    });

    test('does not run while a random event interrupts the walk', async () => {
        spyOn(EventSignal, 'pending').mockReturnValue(true);
        const talk = spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        expect(await Traversal.walkTo(mainland)).toBe(false);
        expect(talk).not.toHaveBeenCalled();
    });

    test('does not replace a missing rope with a banana job', async () => {
        spyOn(WalkExecutor, 'walkTo').mockImplementation(async () => {
            WalkExecutor.lastOutcome = 'failed';
            WalkExecutor.lastMissingGateItems = [{ name: 'Rope', count: 1 }];
            return false;
        });
        const talk = spyOn(primitives, 'talkStrict').mockResolvedValue(true);
        expect(await Traversal.walkTo(mainland)).toBe(false);
        expect(talk).not.toHaveBeenCalled();
    });
});
