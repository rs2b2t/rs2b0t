/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are monkey-patched
   to drive the open path without a live client. */
import { afterEach, expect, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Locs } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';

const BANK_COM = 5382;

const originals = {
    bankComId: reader.bankComId,
    bankItems: reader.bankItems,
    bankSnapshotReady: reader.bankSnapshotReady,
    delayUntil: Execution.delayUntil,
    delayTicks: Execution.delayTicks,
    locQuery: Locs.query,
    chatCanContinue: ChatDialog.canContinue
};

afterEach(() => {
    Object.assign(reader, {
        bankComId: originals.bankComId,
        bankItems: originals.bankItems,
        bankSnapshotReady: originals.bankSnapshotReady
    });
    Object.assign(Execution, { delayUntil: originals.delayUntil, delayTicks: originals.delayTicks });
    (Locs as any).query = originals.locQuery;
    (ChatDialog as any).canContinue = originals.chatCanContinue;
});

interface World {
    open: boolean;
    snapshot: boolean;
    items: InvItemSnapshot[];
}

/** Fake the client reads the bank asks about, plus a polling delayUntil. */
function install(world: World): void {
    Object.assign(reader, {
        bankComId: () => (world.open ? BANK_COM : -1),
        bankItems: () => world.items,
        bankSnapshotReady: () => world.open && world.snapshot
    });
    Object.assign(Execution, {
        delayTicks: async () => {},
        delayUntil: async (cond: () => boolean) => cond()
    });
    (ChatDialog as any).canContinue = () => false;
}

test('ready() believes an empty bank once its snapshot lands, loaded() never can', () => {
    const world: World = { open: true, snapshot: true, items: [] };
    install(world);

    expect(Bank.loaded()).toBe(false);
    expect(Bank.ready()).toBe(true);
    expect(Bank.count('Logs')).toBe(0);
});

test('ready() is false while the bank is open and the list is still in flight', () => {
    install({ open: true, snapshot: false, items: [] });

    expect(Bank.isOpen()).toBe(true);
    expect(Bank.ready()).toBe(false);
});

test('ready() falls back to the item list when no snapshot session exists', () => {
    install({
        open: true,
        snapshot: false,
        items: [{ id: 1511, name: 'Logs', count: 40, slot: 0, comId: BANK_COM, ops: [] }]
    });

    expect(Bank.ready()).toBe(true);
});

test('openNearest does not return until the item list has arrived', async () => {
    const world: World = { open: false, snapshot: false, items: [] };
    install(world);

    let ticks = 0;
    Object.assign(Execution, {
        delayTicks: async () => {},
        // The booth click opens the component now, the server sends the list two polls later.
        delayUntil: async (cond: () => boolean) => {
            for (let i = 0; i < 10; i++) {
                if (cond()) { return true; }
                if (++ticks >= 2) {
                    world.snapshot = true;
                    world.items = [{ id: 1511, name: 'Logs', count: 40, slot: 0, comId: BANK_COM, ops: [] }];
                }
            }
            return cond();
        }
    });

    (Locs as any).query = () => ({
        name: () => ({
            where: () => ({
                nearest: () => ({
                    actions: () => ['Use-quickly'],
                    distance: () => 1,
                    tile: () => ({ x: 3185, z: 3436, level: 0 }),
                    interact: async () => { world.open = true; return true; }
                })
            }),
            nearest: () => null
        })
    });

    expect(await Bank.openNearest('Bank booth', 'Use-quickly')).toBe(true);
    expect(Bank.ready()).toBe(true);
    expect(Bank.count('Logs')).toBe(40);
});
