/* eslint-disable @typescript-eslint/no-explicit-any -- API singleton methods are monkey-patched
   to model the bank modal hiding the normal backpack tab. */
import { afterEach, describe, expect, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Inventory } from '#/bot/api/hud/Inventory.js';
import { ActionRouter } from '#/bot/input/ActionRouter.js';

const originals = {
    bankComId: reader.bankComId,
    bankSideItems: reader.bankSideItems,
    inventory: reader.inventory,
    inventorySize: reader.inventorySize,
    heldOp: ActionRouter.driver.heldOp,
    invButton: ActionRouter.driver.invButton
};

afterEach(() => {
    (reader as any).bankComId = originals.bankComId;
    (reader as any).bankSideItems = originals.bankSideItems;
    (reader as any).inventory = originals.inventory;
    (reader as any).inventorySize = originals.inventorySize;
    (ActionRouter.driver as any).heldOp = originals.heldOp;
    (ActionRouter.driver as any).invButton = originals.invButton;
});

function lobster(slot: number, count = 1, id = 379): InvItemSnapshot {
    return { id, name: 'Lobster', count, slot, comId: 5064, ops: ['Deposit-1', null, null, null, 'Deposit-All'] };
}

describe('Inventory while the bank modal is open', () => {
    test('uses only the visible side backpack for counts and fixed capacity', () => {
        (reader as any).bankComId = () => 5382;
        (reader as any).inventory = () => [lobster(9, 99, 999)];
        // The hidden tab may report a stale size; the bank side backpack is 28 slots.
        (reader as any).inventorySize = () => 99;
        (reader as any).bankSideItems = () => [lobster(0, 2), lobster(1)];

        expect(Inventory.count('Lobster')).toBe(3);
        expect(Inventory.countById(379)).toBe(3);
        expect(Inventory.countById(999)).toBe(0);
        expect(Inventory.used()).toBe(2);
        expect(Inventory.free()).toBe(26);
        expect(Inventory.isFull()).toBe(false);
    });

    test('reports a full 28-slot side backpack even when the hidden tab has no size', () => {
        (reader as any).bankComId = () => 5382;
        (reader as any).inventory = () => [];
        (reader as any).inventorySize = () => 0;
        (reader as any).bankSideItems = () => Array.from({ length: 28 }, (_, slot) => lobster(slot));

        expect(Inventory.used()).toBe(28);
        expect(Inventory.free()).toBe(0);
        expect(Inventory.isFull()).toBe(true);
    });

    test('routes Deposit actions as component buttons and refuses held-item use', async () => {
        const calls: string[] = [];
        (reader as any).bankComId = () => 5382;
        (reader as any).bankSideItems = () => [lobster(4)];
        (ActionRouter.driver as any).heldOp = () => {
            calls.push('held');
            return true;
        };
        (ActionRouter.driver as any).invButton = () => {
            calls.push('button');
            return true;
        };

        const item = Inventory.first('Lobster');
        expect(item).not.toBeNull();
        expect(await item!.interact('Deposit-1')).toBe(true);
        expect(calls).toEqual(['button']);
        expect(await item!.useOn(item!)).toBe(false);
        expect(calls).toEqual(['button']);
    });

    test('keeps normal held-item behavior after the bank closes', async () => {
        const calls: string[] = [];
        (reader as any).bankComId = () => -1;
        (reader as any).inventory = () => [{ ...lobster(0), comId: 3214, ops: ['Eat', null, null, null, 'Drop'] }];
        (reader as any).inventorySize = () => 28;
        (ActionRouter.driver as any).heldOp = () => {
            calls.push('held');
            return true;
        };
        (ActionRouter.driver as any).invButton = () => {
            calls.push('button');
            return true;
        };

        expect(await Inventory.first('Lobster')!.interact('Eat')).toBe(true);
        expect(calls).toEqual(['held']);
    });
});
