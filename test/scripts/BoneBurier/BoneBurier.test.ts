import { afterEach, beforeEach, expect, test } from 'bun:test';
import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory, type InvItem } from '#/bot/api/inventory/Inventory.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import BoneBurier from '#/bot/scripts/BoneBurier/BoneBurier.js';

const original = {
    closeModal: actions.closeModal,
    bankNearest: Banking.bankNearest,
    delayUntil: Execution.delayUntil,
    bankIsOpen: Bank.isOpen,
    bankLoaded: Bank.loaded,
    bankSnapshotReady: Bank.snapshotReady,
    bankItems: Bank.items,
    bankCount: Bank.count,
    bankSetNoteMode: Bank.setNoteMode,
    bankWithdraw: Bank.withdraw,
    inventoryCount: Inventory.count,
    inventoryFirst: Inventory.first,
    inventoryFree: Inventory.free,
    inventorySize: reader.inventorySize,
    stop: ScriptRunner.stop
};

let bankOpen: boolean;
let bankItems: InvItemSnapshot[];
let boneCount: number;
let stops: number;
let withdrawals: { name: string; op: string }[];
let bankCalls: { deposit: (name: string) => boolean }[];

function bot(name = 'Bones'): BoneBurier {
    const instance = new BoneBurier();
    instance.settings = new SettingsBag({ boneName: name });
    (instance as unknown as { boneName: string }).boneName = name;
    return instance;
}

async function restock(instance: BoneBurier): Promise<void> {
    await (instance as unknown as { restock(): Promise<void> }).restock();
}

async function buryOne(instance: BoneBurier): Promise<void> {
    await (instance as unknown as { buryOne(): Promise<void> }).buryOne();
}

beforeEach(() => {
    bankOpen = false;
    bankItems = [];
    boneCount = 0;
    stops = 0;
    withdrawals = [];
    bankCalls = [];

    actions.closeModal = () => {
        bankOpen = false;
        return true;
    };
    Banking.bankNearest = async opts => {
        bankCalls.push({ deposit: opts.deposit });
        bankOpen = true;
        return true;
    };
    Execution.delayUntil = async condition => condition();
    Bank.isOpen = () => bankOpen;
    Bank.loaded = () => bankItems.length > 0;
    Bank.snapshotReady = () => false;
    Bank.items = () => bankItems;
    Bank.count = name => bankItems.find(item => item.name?.toLowerCase() === name.toLowerCase())?.count ?? 0;
    Bank.setNoteMode = async () => {};
    Bank.withdraw = async (name, op = 'Withdraw-1') => {
        withdrawals.push({ name, op });
        boneCount = 28;
        return true;
    };
    Inventory.count = () => boneCount;
    Inventory.free = () => 28 - boneCount;
    reader.inventorySize = () => 28;
    ScriptRunner.stop = () => {
        stops++;
    };
});

afterEach(() => {
    actions.closeModal = original.closeModal;
    Banking.bankNearest = original.bankNearest;
    Execution.delayUntil = original.delayUntil;
    Bank.isOpen = original.bankIsOpen;
    Bank.loaded = original.bankLoaded;
    Bank.snapshotReady = original.bankSnapshotReady;
    Bank.items = original.bankItems;
    Bank.count = original.bankCount;
    Bank.setNoteMode = original.bankSetNoteMode;
    Bank.withdraw = original.bankWithdraw;
    Inventory.count = original.inventoryCount;
    Inventory.first = original.inventoryFirst;
    Inventory.free = original.inventoryFree;
    reader.inventorySize = original.inventorySize;
    ScriptRunner.stop = original.stop;
});

test('withdraws only the exact configured bone name', async () => {
    bankItems = [
        { id: 526, count: 100, slot: 0, name: 'Bones', comId: 5382, ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X'] },
        { id: 536, count: 100, slot: 1, name: 'Dragon bones', comId: 5382, ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X'] }
    ];

    await restock(bot('Bones'));

    expect(withdrawals).toEqual([{ name: 'Bones', op: 'Withdraw-All' }]);
    expect(stops).toBe(0);
});

test('closes the bank and stops when the configured bones run out', async () => {
    bankItems = [
        { id: 536, count: 100, slot: 0, name: 'Dragon bones', comId: 5382, ops: ['Withdraw-1', 'Withdraw-All'] }
    ];

    await restock(bot('Bones'));

    expect(bankOpen).toBe(false);
    expect(withdrawals).toEqual([]);
    expect(stops).toBe(1);
});

test('finishing a single delegated baby bone returns to the leveler without stopping it', async () => {
    const instance = bot('Babydragon bones');
    const finished: string[] = [];
    instance.bindFinish(reason => finished.push(reason));
    boneCount = 1;
    bankItems = [{ id: 995, count: 100, slot: 0, name: 'Coins', comId: 5382, ops: ['Withdraw-All'] }];
    Inventory.first = () => ({ interact: async () => { boneCount--; return true; } }) as unknown as InvItem;
    await instance.loop();
    await instance.loop();
    expect(boneCount).toBe(0);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toContain('Babydragon bones');
    expect(stops).toBe(0);
});

test('deposits the whole pack on restock, even when it is already full', async () => {
    bankItems = [
        { id: 526, count: 100, slot: 0, name: 'Bones', comId: 5382, ops: ['Withdraw-1', 'Withdraw-All'] }
    ];
    Inventory.free = () => 0;

    await restock(bot('Bones'));

    expect(stops).toBe(0);
    expect(bankCalls).toHaveLength(1);
    expect(bankCalls[0]!.deposit('Strange fruit')).toBe(true);
    expect(bankCalls[0]!.deposit('Bones')).toBe(true);
    expect(withdrawals).toEqual([{ name: 'Bones', op: 'Withdraw-All' }]);
});

test('closes the bank before burying and records progress', async () => {
    bankOpen = true;
    boneCount = 3;
    Inventory.first = () => ({
        interact: async (op: string) => {
            expect(op).toBe('Bury');
            boneCount--;
            return true;
        },
        actions: () => ['Bury']
    }) as unknown as InvItem;
    const instance = bot();

    await buryOne(instance);

    expect(bankOpen).toBe(false);
    expect(boneCount).toBe(2);
    expect((instance as unknown as { burials: number }).burials).toBe(1);
    expect(stops).toBe(0);
});

test('finishes immediately on a synchronized empty bank', async () => {
    Bank.snapshotReady = () => true;
    await restock(bot());
    expect(stops).toBe(1);
    expect(withdrawals).toEqual([]);
});

test('missing snapshots do not count as exhausted stock', async () => {
    const instance = bot();
    for (let i = 0; i < 4; i++) await restock(instance);
    expect(stops).toBe(0);
    expect(withdrawals).toEqual([]);
});
