/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to exercise exact-ID bank operations without a live client. */
import { afterEach, describe, expect, test } from 'bun:test';

import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/Execution.js';
import { Bank } from '#/bot/api/hud/Bank.js';
import { ActionRouter } from '#/bot/input/ActionRouter.js';

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
    invButton: ActionRouter.driver.invButton
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
    (ActionRouter.driver as any).invButton = originals.invButton;
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

describe('Bank exact-ID helpers', () => {
    test('counts and clicks only the requested ID when names collide', async () => {
        const bankItems = [item(293, 2, 0), item(298, 3, 1), item(293, 4, 2)];
        const clicked: number[] = [];
        (reader as any).bankItems = () => bankItems;
        (ActionRouter.driver as any).invButton = (id: number) => {
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
        (ActionRouter.driver as any).invButton = (id: number) => {
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
