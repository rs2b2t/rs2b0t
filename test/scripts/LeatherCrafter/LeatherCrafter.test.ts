import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { actions, reader, type InvItemSnapshot, type WorldTile } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { InvItem, Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Input } from '#/bot/input/Input.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import LeatherCrafter from '#/bot/scripts/LeatherCrafter/LeatherCrafter.js';

const NEEDLE = 1733;
const THREAD = 1734;
const LEATHER = 1741;
const BANK_TILE: WorldTile = { x: 3269, z: 3167, level: 0 };

const original = {
    delayUntil: Execution.delayUntil,
    ingame: Game.ingame,
    tile: Game.tile,
    sceneState: reader.sceneState,
    skillLevel: Skills.level,
    skillXp: Skills.xp,
    bankItems: Bank.items,
    bankLoaded: Bank.loaded,
    bankOpenNearest: Bank.openNearest,
    bankIsOpen: Bank.isOpen,
    inventoryItems: Inventory.items,
    inventoryUsed: Inventory.used,
    inventorySize: reader.inventorySize,
    bankSideItems: reader.bankSideItems,
    countDialogOpen: reader.countDialogOpen,
    invButton: Input.invButton,
    answerCountDialog: actions.answerCountDialog,
    closeModal: actions.closeModal,
    stop: ScriptRunner.stop
};

let logs: string[];
let stops: string[];
let bankOpen: boolean;
let sideReady: boolean;
let dialogOpen: boolean;
let pendingId: number | null;
let inventoryCounts: Map<number, number>;
let bankContents: InvItemSnapshot[];
let clickedIds: number[];
let occupiedAfterThreadTopUp: number | null;

function itemName(id: number): string {
    if (id === NEEDLE) {
        return 'Needle';
    }
    if (id === THREAD) {
        return 'Thread';
    }
    if (id === LEATHER) {
        return 'Leather';
    }
    return `#${id}`;
}

function snapshot(id: number, count: number, slot: number): InvItemSnapshot {
    return {
        id,
        count,
        slot,
        name: itemName(id),
        comId: 5382,
        ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', 'Withdraw-X']
    };
}

function inventory(): InvItem[] {
    return [...inventoryCounts.entries()]
        .filter(([, count]) => count > 0)
        .map(([id, count], slot) => new InvItem({
            id,
            count,
            slot,
            name: itemName(id),
            comId: 3214,
            ops: [null, null, null, null, 'Drop']
        }));
}

function bot(leatherType = 'Hard leather'): LeatherCrafter {
    const instance = new LeatherCrafter();
    instance.settings = new SettingsBag({ leatherType, threadPerTrip: 100 });
    instance.bindLog(message => logs.push(message));
    return instance;
}

async function runBankLeg(instance = bot('Leather')): Promise<void> {
    await (instance as unknown as { bankLeg(): Promise<void> }).bankLeg();
}

beforeEach(() => {
    logs = [];
    stops = [];
    bankOpen = true;
    sideReady = true;
    dialogOpen = false;
    pendingId = null;
    inventoryCounts = new Map<number, number>();
    bankContents = [];
    clickedIds = [];
    occupiedAfterThreadTopUp = null;

    Game.ingame = () => true;
    Game.tile = () => BANK_TILE;
    reader.sceneState = () => 2;
    Skills.level = name => name === 'crafting' ? 28 : 1;
    Skills.xp = () => 100_000;

    Bank.items = () => bankContents;
    Bank.loaded = () => bankContents.length > 0;
    Bank.openNearest = async () => true;
    Bank.isOpen = () => bankOpen;
    Inventory.items = () => inventory();
    Inventory.used = () => inventory().length;
    reader.inventorySize = () => 28;
    reader.bankSideItems = () => sideReady ? inventory().map(item => item.snap) : [];
    reader.countDialogOpen = () => dialogOpen;

    Input.invButton = id => {
        clickedIds.push(id);
        pendingId = id;
        dialogOpen = true;
        return true;
    };
    actions.answerCountDialog = count => {
        if (pendingId === null) {
            return false;
        }
        const id = pendingId;
        inventoryCounts.set(id, (inventoryCounts.get(id) ?? 0) + count);
        if (id === THREAD) {
            occupiedAfterThreadTopUp = Inventory.used();
        }
        pendingId = null;
        dialogOpen = false;
        return true;
    };
    actions.closeModal = () => {
        bankOpen = false;
        return true;
    };
    Execution.delayUntil = async condition => condition();
    ScriptRunner.stop = reason => {
        stops.push(reason);
    };
});

afterEach(() => {
    Execution.delayUntil = original.delayUntil;
    Game.ingame = original.ingame;
    Game.tile = original.tile;
    reader.sceneState = original.sceneState;
    Skills.level = original.skillLevel;
    Skills.xp = original.skillXp;
    Bank.items = original.bankItems;
    Bank.loaded = original.bankLoaded;
    Bank.openNearest = original.bankOpenNearest;
    Bank.isOpen = original.bankIsOpen;
    Inventory.items = original.inventoryItems;
    Inventory.used = original.inventoryUsed;
    reader.inventorySize = original.inventorySize;
    reader.bankSideItems = original.bankSideItems;
    reader.countDialogOpen = original.countDialogOpen;
    Input.invButton = original.invButton;
    actions.answerCountDialog = original.answerCountDialog;
    actions.closeModal = original.closeModal;
    ScriptRunner.stop = original.stop;
});

describe('LeatherCrafter startup readiness', () => {
    test('waits for both the scene and Crafting stat before selecting a recipe', async () => {
        let sceneState = 0;
        let crafting = 28;
        const readiness: boolean[] = [];

        reader.sceneState = () => sceneState;
        Skills.level = name => name === 'crafting' ? crafting : 1;
        Execution.delayUntil = async condition => {
            readiness.push(condition());
            sceneState = 2;
            crafting = 0;
            readiness.push(condition());
            crafting = 28;
            readiness.push(condition());
            return true;
        };

        await bot().onStart();

        expect(readiness).toEqual([false, false, true]);
        expect(stops).toEqual([]);
        expect(logs).toContain('LeatherCrafter — Hard leather -> Hardleather body (level 28, 1 per item)');
        expect(logs.some(message => message.includes('Crafting 0'))).toBe(false);
    });

    test('still stops when a loaded Crafting level is genuinely too low', async () => {
        Skills.level = name => name === 'crafting' ? 27 : 1;

        await bot().onStart();

        expect(stops).toEqual(['Crafting 27 is too low for Hard leather (needs 28)']);
    });
});

describe('LeatherCrafter bank withdrawals', () => {
    test('recognises a successful thread stack top-up without a new inventory slot', async () => {
        inventoryCounts.set(NEEDLE, 1);
        inventoryCounts.set(THREAD, 4);
        bankContents = [snapshot(THREAD, 500, 2), snapshot(LEATHER, 500, 3)];
        const occupiedBefore = Inventory.used();

        await runBankLeg();

        expect(inventoryCounts.get(THREAD)).toBe(104);
        expect(clickedIds).toEqual([THREAD, LEATHER]);
        expect(occupiedBefore).toBe(2);
        expect(occupiedAfterThreadTopUp).toBe(occupiedBefore);
        expect(stops).toEqual([]);
        expect(bankOpen).toBe(false);
        expect(logs.some(message => message.includes('no thread'))).toBe(false);
    });

    test('retries without stopping when the bank contents have not loaded', async () => {
        inventoryCounts.set(NEEDLE, 1);
        Bank.loaded = () => false;

        await runBankLeg();

        expect(stops).toEqual([]);
        expect(clickedIds).toEqual([]);
        expect(logs).toContain('bank contents not ready — retrying');
    });

    test('retries without stopping when a visible withdrawal action is rejected', async () => {
        inventoryCounts.set(NEEDLE, 1);
        bankContents = [snapshot(THREAD, 500, 2), snapshot(LEATHER, 500, 3)];
        Input.invButton = id => {
            clickedIds.push(id);
            return false;
        };

        await runBankLeg();

        expect(stops).toEqual([]);
        expect(clickedIds).toEqual([THREAD]);
        expect(logs).toContain('could not withdraw thread — retrying');
    });

    test('retries while the main bank view rehydrates after a deposit', async () => {
        inventoryCounts.set(NEEDLE, 1);
        bankContents = [snapshot(THREAD, 500, 2), snapshot(LEATHER, 500, 3)];
        let loadedReads = 0;
        Bank.loaded = () => ++loadedReads === 1;

        await runBankLeg();

        expect(stops).toEqual([]);
        expect(clickedIds).toEqual([]);
        expect(logs).toContain('could not withdraw thread — retrying');
        expect(logs.some(message => message.includes('no thread'))).toBe(false);
    });

    test('retries without stopping when the deposit-side inventory is not ready', async () => {
        inventoryCounts.set(NEEDLE, 1);
        inventoryCounts.set(THREAD, 10);
        bankContents = [snapshot(LEATHER, 500, 3)];
        sideReady = false;

        await runBankLeg();

        expect(stops).toEqual([]);
        expect(clickedIds).toEqual([]);
        expect(logs).toContain('bank inventory view not ready — retrying');
    });

    test('stops only when a loaded bank proves thread is missing', async () => {
        inventoryCounts.set(NEEDLE, 1);
        bankContents = [snapshot(LEATHER, 500, 3)];

        await runBankLeg();

        expect(stops).toEqual(['no thread in the bank']);
        expect(clickedIds).toEqual([]);
    });
});
