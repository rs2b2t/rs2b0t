import { afterEach, describe, expect, test } from 'bun:test';
import type { Page } from 'playwright-core';
import { seedItemsToBank } from '../../e2e/tutorial/harness.js';
import { MiniMenuAction } from '../../src/client/shell/MiniMenuAction.js';

type Definition = { id: number; debugName: string; name: string; stackable: boolean; certlink: number; certtemplate: number };
const definitions: Definition[] = [
    { id: 377, debugName: 'raw_lobster', name: 'Raw lobster', stackable: false, certlink: -1, certtemplate: -1 },
    { id: 378, debugName: 'cert_raw_lobster', name: 'Raw lobster', stackable: true, certlink: 377, certtemplate: 799 },
    { id: 995, debugName: 'coins', name: 'Coins', stackable: true, certlink: -1, certtemplate: -1 },
    { id: 100, debugName: 'hide_a', name: 'Dragonhide', stackable: false, certlink: -1, certtemplate: -1 },
    { id: 101, debugName: 'cert_hide_a', name: 'Dragonhide', stackable: true, certlink: 100, certtemplate: 799 },
    { id: 102, debugName: 'hide_b', name: 'Dragonhide', stackable: false, certlink: -1, certtemplate: -1 },
    { id: 103, debugName: 'cert_hide_b', name: 'Dragonhide', stackable: true, certlink: 102, certtemplate: 799 },
    { id: 200, debugName: 'quest_key', name: 'Quest key', stackable: false, certlink: -1, certtemplate: -1 }
];
const stand = { x: 3092, z: 3243, level: 0 };
const lobsterSeed = [{ debugName: 'raw_lobster', displayName: 'Raw lobster', qty: 973 }];
const globals = globalThis as unknown as Record<string, unknown>;
const saved = new Map(['rs2b0t', '__rs2b0t', '__seedBank'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
afterEach(() => {
    for (const [key, descriptor] of saved) {
        if (descriptor) {
            Object.defineProperty(globalThis, key, descriptor);
        } else {
            delete globals[key];
        }
    }
});

/** Execute the browser callbacks against an in-memory inventory and bank. */
function fixture(options: { ignoreGive?: boolean; loseDeposit?: boolean; ready?: boolean } = {}) {
    const inventory = new Map<number, number>();
    const bank = new Map<number, number>();
    const commands: string[] = [];
    const countAnswers: number[] = [];
    let pending: Promise<unknown> = Promise.resolve();
    let script: { create(): { loop(): Promise<unknown> } };
    let depositId: number | undefined;
    let stopped = false;
    const count = (id: number) => inventory.get(id) ?? 0;
    const snapshots = () => {
        const items: { id: number; count: number; slot: number; comId: number; ops: string[] }[] = [];
        for (const [id, qty] of inventory) {
            const definition = definitions.find(d => d.id === id)!;
            for (let i = 0; i < (definition.stackable ? Math.min(1, qty) : qty); i++) {
                items.push({ id, count: definition.stackable ? qty : 1, slot: items.length, comId: 2006, ops: ['Deposit-1', 'Deposit-5', 'Deposit-10', 'Deposit-All', 'Deposit-X'] });
            }
        }
        return items;
    };
    const deposit = (id: number, qty: number) => {
        inventory.set(id, count(id) - qty);
        const definition = definitions.find(d => d.id === id)!;
        const bankId = definition.certtemplate === -1 ? id : definition.certlink;
        if (!options.loseDeposit) {
            bank.set(bankId, (bank.get(bankId) ?? 0) + qty);
        }
    };
    globals.rs2b0t = {
        client: {
            ingame: true,
            out: {
                p1Enc: () => undefined,
                p1: () => undefined,
                pjstr: (command: string) => {
                    if (command.startsWith('tele ')) {
                        return;
                    }
                    commands.push(command);
                    if (options.ignoreGive) {
                        return;
                    }
                    const [, debugName, quantity] = command.split(' ');
                    const definition = definitions.find(d => d.debugName === debugName);
                    if (!definition) {
                        return;
                    }
                    const free = 28 - snapshots().length;
                    const added = definition.stackable ? (free > 0 || count(definition.id) > 0 ? Number(quantity) : 0) : Math.min(free, Number(quantity));
                    inventory.set(definition.id, count(definition.id) + added);
                }
            }
        },
        reader: {
            bankSideItems: snapshots,
            objCatalog: () => definitions,
            countDialogOpen: () => depositId !== undefined
        },
        actions: {
            menuAction: (action: number, id: number, _slot: number, _comId: number) => {
                if (action === MiniMenuAction.INV_BUTTON5) {
                    depositId = id;
                } else if (action === MiniMenuAction.INV_BUTTON4) {
                    deposit(id, count(id));
                } else {
                    return false;
                }
                return true;
            },
            answerCountDialog: (qty: number) => {
                countAnswers.push(qty);
                deposit(depositId!, qty);
                depositId = undefined;
                return true;
            }
        },
        registry: { get: () => script },
        runner: {
            start: () => { pending = script.create().loop(); },
            stop: () => { stopped = true; }
        }
    };
    globals.__rs2b0t = {
        Game: { tile: () => stand },
        LoopingBot: class {},
        registerScript: (meta: typeof script) => { script = meta; },
        Bank: {
            openBooth: async () => true,
            openNearest: async () => true,
            waitReady: async () => options.ready ?? true,
            close: async () => true,
            countById: (id: number) => bank.get(id) ?? 0
        },
        Execution: {
            delayUntil: async (predicate: () => boolean) => predicate(),
            delayTicks: async () => undefined
        }
    };
    const page = {
        evaluate: async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg),
        waitForTimeout: async () => undefined,
        waitForFunction: async (fn: (arg: unknown) => boolean, arg: unknown) => {
            await pending;
            if (!fn(arg)) {
                throw new Error('condition did not become true');
            }
        }
    } as unknown as Page;
    return { page, inventory, bank, commands, countAnswers, stopped: () => stopped };
}

describe('bank fixture deposits', () => {
    test('973 unstackable items arrive as one noted stack and add to the unnoted bank', async () => {
        const f = fixture();
        f.bank.set(377, 7);
        f.inventory.set(377, 3);
        await seedItemsToBank(f.page, lobsterSeed, stand);
        expect(f.commands).toEqual(['give cert_raw_lobster 973']);
        expect(f.bank.get(377)).toBe(980);
        expect(f.bank.has(378)).toBe(false);
        expect(f.inventory.get(377)).toBe(3);
        expect(f.inventory.get(378)).toBe(0);
        expect(f.stopped()).toBe(true);
    });

    test('preserves existing notes using the exact deposit count', async () => {
        const f = fixture();
        f.inventory.set(378, 12);
        await seedItemsToBank(f.page, lobsterSeed, stand);
        expect(f.countAnswers).toEqual([973]);
        expect(f.inventory.get(378)).toBe(12);
        expect(f.bank.get(377)).toBe(973);
    });

    test('ordinary stackables use their original object and preserve held coins', async () => {
        const f = fixture();
        f.inventory.set(995, 990);
        await seedItemsToBank(f.page, [{ debugName: 'coins', displayName: 'Coins', qty: 500000 }], stand);
        expect(f.commands).toEqual(['give coins 500000']);
        expect(f.inventory.get(995)).toBe(990);
        expect(f.bank.get(995)).toBe(500000);
    });

    test('items sharing a display name are verified against distinct unnoted IDs', async () => {
        const f = fixture();
        await seedItemsToBank(f.page, [
            { debugName: 'hide_a', displayName: 'Dragonhide', qty: 120 },
            { debugName: 'hide_b', displayName: 'Dragonhide', qty: 80 }
        ], stand);
        expect(f.commands).toEqual(['give cert_hide_a 120', 'give cert_hide_b 80']);
        expect(f.bank.get(100)).toBe(120);
        expect(f.bank.get(102)).toBe(80);
    });

    test('an item without a note can be deposited when it fits', async () => {
        const f = fixture();
        await seedItemsToBank(f.page, [{ debugName: 'quest_key', displayName: 'Quest key', qty: 1 }], stand);
        expect(f.commands).toEqual(['give quest_key 1']);
        expect(f.bank.get(200)).toBe(1);
    });

    test('an unsupported command cannot pass using preexisting bank stock', async () => {
        const f = fixture({ ignoreGive: true });
        f.bank.set(377, 1000);
        await expect(seedItemsToBank(f.page, lobsterSeed, stand)).rejects.toThrow('inventory did not increase');
        expect(f.stopped()).toBe(true);
    });

    test('inventory removal alone does not prove a bank deposit', async () => {
        const f = fixture({ loseDeposit: true });
        await expect(seedItemsToBank(f.page, lobsterSeed, stand)).rejects.toThrow('deposit not verified');
        expect(f.stopped()).toBe(true);
    });

    test('oversized fixtures without notes fail before issuing a give', async () => {
        const f = fixture();
        await expect(seedItemsToBank(f.page, [{ debugName: 'quest_key', displayName: 'Quest key', qty: 29 }], stand)).rejects.toThrow('has no note');
        expect(f.commands).toEqual([]);
    });

    test('an unready bank fails before issuing a give', async () => {
        const f = fixture({ ready: false });
        await expect(seedItemsToBank(f.page, lobsterSeed, stand)).rejects.toThrow('could not open a ready bank');
        expect(f.commands).toEqual([]);
    });
});
