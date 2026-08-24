/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to exercise exact-ID bank operations without a live client. */
import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Input } from '#/bot/input/Input.js';

const originals = {
    answerCountDialog: actions.answerCountDialog,
    bankComId: reader.bankComId,
    bankItems: reader.bankItems,
    bankSideItems: reader.bankSideItems,
    countDialogOpen: reader.countDialogOpen,
    inventory: reader.inventory,
    inventorySize: reader.inventorySize,
    modals: reader.modals,
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    invButton: Input.invButton
};

afterEach(() => {
    (actions as any).answerCountDialog = originals.answerCountDialog;
    (reader as any).bankComId = originals.bankComId;
    (reader as any).bankItems = originals.bankItems;
    (reader as any).bankSideItems = originals.bankSideItems;
    (reader as any).countDialogOpen = originals.countDialogOpen;
    (reader as any).inventory = originals.inventory;
    (reader as any).inventorySize = originals.inventorySize;
    (reader as any).modals = originals.modals;
    (Execution as any).delayTicks = originals.delayTicks;
    (Execution as any).delayUntil = originals.delayUntil;
    (Input as any).invButton = originals.invButton;
});

function item(id: number, count: number, slot: number): InvItemSnapshot {
    return {
        id,
        name: 'A key',
        count,
        slot,
        comId: 5382,
        ops: ['Withdraw-1', null, null, null, 'Withdraw-X']
    };
}

function namedItem(count: number): InvItemSnapshot {
    return {
        id: 379,
        name: 'Lobster',
        count,
        slot: 0,
        comId: 5382,
        ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', null, 'Withdraw-X']
    };
}

describe('Bank exact-ID helpers', () => {
    test('counts and clicks only the requested ID when names collide', async () => {
        const bankItems = [item(293, 2, 0), item(298, 3, 1), item(293, 4, 2)];
        const clicked: number[] = [];
        (reader as any).bankItems = () => bankItems;
        (Input as any).invButton = (id: number) => {
            clicked.push(id);
            return true;
        };

        expect(Bank.countById(293)).toBe(6);
        expect(Bank.countById(298)).toBe(3);
        expect(await Bank.withdrawById(298)).toBe(true);
        expect(await Bank.withdrawById(999)).toBe(false);
        expect(await Bank.withdrawXById(999, 1)).toBe(false);
        expect(clicked).toEqual([298]);
    });

    test('Withdraw-X waits for inventory progress on the exact requested ID', async () => {
        let bankItems = [item(293, 1, 0), item(298, 5, 1)];
        let inventory: InvItemSnapshot[] = [];
        const clicked: number[] = [];

        (reader as any).bankComId = () => 5382;
        (reader as any).bankItems = () => bankItems;
        (reader as any).bankSideItems = () => inventory;
        (reader as any).inventory = () => inventory;
        (reader as any).inventorySize = () => 28;
        (reader as any).modals = () => ({ main: 5292, side: 5063, chat: -1 });
        (reader as any).countDialogOpen = () => true;
        (Execution as any).delayTicks = async () => {};
        (Execution as any).delayUntil = async (condition: () => boolean) => condition();
        (Input as any).invButton = (id: number) => {
            clicked.push(id);
            return true;
        };
        (actions as any).answerCountDialog = (count: number) => {
            inventory = [{ ...item(298, count, 0), comId: 3214 }];
            bankItems = [item(293, 1, 0), item(298, 5 - count, 1)];
            return true;
        };

        expect(await Bank.withdrawXById(298, 2)).toBe(true);
        expect(clicked).toEqual([298]);
        expect(inventory[0]?.id).toBe(298);
        expect(inventory[0]?.count).toBe(2);
        expect(Bank.countById(293)).toBe(1);
    });
});

describe('Bank named Withdraw-X', () => {
    function readyBank(inventory: () => InvItemSnapshot[]): void {
        (reader as any).bankComId = () => 5382;
        (reader as any).bankSideItems = inventory;
        (reader as any).inventory = inventory;
        (reader as any).inventorySize = () => 28;
        (reader as any).modals = () => ({ main: 5292, side: 5063, chat: -1 });
        (reader as any).countDialogOpen = () => true;
        (Execution as any).delayTicks = async () => {};
        (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    }

    test('uses fixed 1/5/10 operations without opening a count dialog', async () => {
        for (const [quantity, operation] of [[1, 1], [5, 2], [10, 3]] as const) {
            let inventory: InvItemSnapshot[] = [];
            (reader as any).bankItems = () => [namedItem(20)];
            readyBank(() => inventory);
            let clickedOperation = 0;
            (Input as any).invButton = (_id: number, _slot: number, _comId: number, op: number) => {
                clickedOperation = op;
                inventory = [{ ...namedItem(quantity), comId: 3214 }];
                return true;
            };
            (actions as any).answerCountDialog = () => {
                throw new Error('fixed withdrawal must not use the count dialog');
            };

            expect(await Bank.withdrawX('Lobster', quantity)).toBe(true);
            expect(clickedOperation).toBe(operation);
        }
    });

    test('routes a non-1/5/10 quantity through the Withdraw-X dialog in a single click', async () => {
        let bankCount = 100;
        let inventory: InvItemSnapshot[] = [];
        let clickedOperation = 0;
        let answered = 0;
        (reader as any).bankItems = () => [namedItem(bankCount)];
        readyBank(() => inventory);
        (Input as any).invButton = (_id: number, _slot: number, _comId: number, op: number) => {
            clickedOperation = op;
            return true;
        };
        (actions as any).answerCountDialog = (quantity: number) => {
            answered = quantity;
            const carried = inventory[0]?.count ?? 0;
            inventory = [{ ...namedItem(carried + quantity), comId: 3214 }];
            bankCount -= quantity;
            return true;
        };

        expect(await Bank.withdrawX('Lobster', 40)).toBe(true);
        expect(clickedOperation).toBe(5); // Withdraw-X op, not a 10/5/1 decomposition
        expect(answered).toBe(40);
        expect(inventory[0]?.count).toBe(40);
    });

    test('Withdraw-X answers with available stock rather than the larger request', async () => {
        let inventory: InvItemSnapshot[] = [];
        const xOnlyItem = (): InvItemSnapshot => ({
            ...namedItem(3),
            ops: [null, null, null, null, 'Withdraw-X']
        });
        (reader as any).bankItems = () => [xOnlyItem()];
        readyBank(() => inventory);
        let answered = 0;
        (Input as any).invButton = () => true;
        (actions as any).answerCountDialog = (quantity: number) => {
            answered = quantity;
            inventory = [{ ...namedItem(quantity), comId: 3214 }];
            return true;
        };

        expect(await Bank.withdrawX('Lobster', 10)).toBe(true);
        expect(answered).toBe(3);
    });
});

describe('Bank.withdrawLoad', () => {
    function readyBank(inventory: () => InvItemSnapshot[]): void {
        (reader as any).bankComId = () => 5382;
        (reader as any).bankSideItems = inventory;
        (reader as any).inventory = inventory;
        (reader as any).inventorySize = () => 28;
        (reader as any).modals = () => ({ main: 5292, side: 5063, chat: -1 });
        (reader as any).countDialogOpen = () => true;
        (Execution as any).delayTicks = async () => {};
        (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    }

    test('uses Withdraw-All when the op exists', async () => {
        let inventory: InvItemSnapshot[] = [];
        const allItem = (): InvItemSnapshot => ({
            ...namedItem(80),
            ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X']
        });
        (reader as any).bankItems = () => [allItem()];
        readyBank(() => inventory);
        let clickedOperation = 0;
        (Input as any).invButton = (_id: number, _slot: number, _comId: number, op: number) => {
            clickedOperation = op;
            inventory = Array.from({ length: 28 }, (_, slot) => ({ ...namedItem(1), slot, comId: 3214 }));
            return true;
        };
        (actions as any).answerCountDialog = () => {
            throw new Error('Withdraw-All must not use the count dialog');
        };

        expect(await Bank.withdrawLoad('Lobster')).toBe(true);
        expect(clickedOperation).toBe(4);
        expect(inventory).toHaveLength(28);
    });

    test('Withdraw-X fills free slots when All is missing', async () => {
        let inventory: InvItemSnapshot[] = [];
        let answered = 0;
        let clickedOperation = 0;
        (reader as any).bankItems = () => [namedItem(80)];
        readyBank(() => inventory);
        (Input as any).invButton = (_id: number, _slot: number, _comId: number, op: number) => {
            clickedOperation = op;
            return true;
        };
        (actions as any).answerCountDialog = (quantity: number) => {
            answered = quantity;
            inventory = Array.from({ length: quantity }, (_, slot) => ({ ...namedItem(1), slot, comId: 3214 }));
            return true;
        };

        expect(await Bank.withdrawLoad('Lobster')).toBe(true);
        expect(clickedOperation).toBe(5);
        expect(answered).toBe(28);
        expect(inventory).toHaveLength(28);
    });

    test('returns false when the item is not in the bank', async () => {
        (reader as any).bankItems = () => [namedItem(20)];
        readyBank(() => []);
        (Input as any).invButton = () => {
            throw new Error('must not click a missing item');
        };

        expect(await Bank.withdrawLoad('Shark')).toBe(false);
    });

    test('returns true without clicking when the pack is already full', async () => {
        const inventory = Array.from({ length: 28 }, (_, slot) => ({ ...namedItem(1), slot, comId: 3214 }));
        (reader as any).bankItems = () => [namedItem(80)];
        readyBank(() => inventory);
        (Input as any).invButton = () => {
            throw new Error('a full pack must not withdraw');
        };

        expect(await Bank.withdrawLoad('Lobster')).toBe(true);
    });
});
