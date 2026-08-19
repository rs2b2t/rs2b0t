/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are patched for deterministic timing. */
import { afterEach, describe, expect, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Bank } from '#/bot/api/bank/Bank.js';

const originals = {
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    bankComId: reader.bankComId,
    modals: reader.modals,
    inventory: reader.inventory,
    inventorySize: reader.inventorySize,
    inventorySnapshotReady: reader.inventorySnapshotReady,
    bankSideItems: reader.bankSideItems,
    bankSideSnapshotReady: reader.bankSideSnapshotReady
};

afterEach(() => {
    (Execution as any).delayTicks = originals.delayTicks;
    (Execution as any).delayUntil = originals.delayUntil;
    (reader as any).bankComId = originals.bankComId;
    (reader as any).modals = originals.modals;
    (reader as any).inventory = originals.inventory;
    (reader as any).inventorySize = originals.inventorySize;
    (reader as any).inventorySnapshotReady = originals.inventorySnapshotReady;
    (reader as any).bankSideItems = originals.bankSideItems;
    (reader as any).bankSideSnapshotReady = originals.bankSideSnapshotReady;
});

function item(count = 4): InvItemSnapshot {
    return {
        slot: 3,
        id: 1891,
        name: 'Cake',
        count,
        ops: ['Eat', null, null, null, 'Drop'],
        comId: 3214
    };
}

describe('Bank.backpackReady', () => {
    function openBank(): void {
        (reader as any).bankComId = () => 5382;
        (reader as any).modals = () => ({ main: 5292, side: 2005, chat: -1 });
        (reader as any).inventorySize = () => 28;
        (reader as any).inventorySnapshotReady = () => true;
        (reader as any).bankSideSnapshotReady = () => true;
        (Execution as any).delayTicks = async () => {};
        (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    }

    test('rejects an empty side view when the pre-open backpack had Cake', async () => {
        openBank();
        (reader as any).inventory = () => [];
        (reader as any).inventorySize = () => 0;
        (reader as any).bankSideItems = () => [];

        expect(await Bank.backpackReady([item()])).toBe(false);
    });

    test('accepts a genuinely empty full side snapshot', async () => {
        openBank();
        (reader as any).inventorySize = () => 0;
        (reader as any).inventory = () => [];
        (reader as any).bankSideItems = () => [];

        expect(await Bank.backpackReady([])).toBe(true);
    });

    test('accepts an expected bank-side backpack when the modal hides normal inventory', async () => {
        openBank();
        (reader as any).inventorySize = () => 0;
        (reader as any).inventory = () => [];
        (reader as any).bankSideItems = () => [item()];

        expect(await Bank.backpackReady([item()])).toBe(true);
    });

    test('rejects an unloaded bank-side backpack when an expected item is known', async () => {
        openBank();
        (reader as any).inventorySize = () => 0;
        (reader as any).inventory = () => [];
        (reader as any).bankSideItems = () => [];

        expect(await Bank.backpackReady([item()])).toBe(false);
    });

    test('rejects an empty side view until its full snapshot arrives', async () => {
        openBank();
        (reader as any).inventorySize = () => 0;
        (reader as any).inventory = () => [];
        (reader as any).bankSideItems = () => [];
        (reader as any).bankSideSnapshotReady = () => false;

        expect(await Bank.backpackReady([])).toBe(false);
    });

    test('accepts matching slots and rejects stale counts', async () => {
        openBank();
        (reader as any).inventorySize = () => 0;
        (reader as any).inventory = () => [];
        (reader as any).bankSideItems = () => [{ ...item(), comId: 2006, ops: ['Deposit-1'] }];
        expect(await Bank.backpackReady([item()])).toBe(true);

        (reader as any).bankSideItems = () => [{ ...item(3), comId: 2006, ops: ['Deposit-1'] }];
        expect(await Bank.backpackReady([item()])).toBe(false);
    });
});

describe('Bank.normalBackpackSnapshot', () => {
    test('returns cloned items, including a valid empty backpack, only outside the bank', () => {
        (reader as any).bankComId = () => -1;
        (reader as any).inventorySize = () => 28;
        (reader as any).inventorySnapshotReady = () => true;
        const original = item();
        (reader as any).inventory = () => [original];

        const snapshot = Bank.normalBackpackSnapshot();
        expect(snapshot).toEqual([{ slot: 3, id: 1891, name: 'Cake', count: 4 }]);
        expect(snapshot?.[0]).not.toBe(original);

        (reader as any).inventory = () => [];
        expect(Bank.normalBackpackSnapshot()).toEqual([]);

        (reader as any).bankComId = () => 5382;
        expect(Bank.normalBackpackSnapshot()).toBeNull();

        (reader as any).bankComId = () => -1;
        (reader as any).inventorySize = () => 0;
        expect(Bank.normalBackpackSnapshot()).toBeNull();
    });

    test('rejects retained component contents before this login receives a full snapshot', () => {
        (reader as any).bankComId = () => -1;
        (reader as any).inventorySize = () => 28;
        (reader as any).inventory = () => [item()];
        (reader as any).inventorySnapshotReady = () => false;

        expect(Bank.normalBackpackSnapshot()).toBeNull();
    });
});
