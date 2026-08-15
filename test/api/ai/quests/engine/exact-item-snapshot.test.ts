/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons and private snapshot
   assembly are exercised without constructing a live bot host. */
import { afterEach, expect, test } from 'bun:test';

import { Game } from '#/bot/api/game/Game.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { QuestEngine } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import type { QuestModule, QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const originals = {
    bankIsOpen: Bank.isOpen,
    bankLoaded: Bank.loaded,
    bankItems: Bank.items,
    equipmentItems: Equipment.items,
    gameTile: Game.tile,
    inventoryFree: Inventory.free,
    inventoryItems: Inventory.items,
    questStatus: Quests.status
};

afterEach(() => {
    (Bank as any).isOpen = originals.bankIsOpen;
    (Bank as any).loaded = originals.bankLoaded;
    (Bank as any).items = originals.bankItems;
    (Equipment as any).items = originals.equipmentItems;
    (Game as any).tile = originals.gameTile;
    (Inventory as any).free = originals.inventoryFree;
    (Inventory as any).items = originals.inventoryItems;
    (Quests as any).status = originals.questStatus;
});

test('quest snapshots retain exact IDs alongside legacy name totals', () => {
    let bankOpen = true;
    (Bank as any).isOpen = () => bankOpen;
    (Bank as any).loaded = () => true;
    (Bank as any).items = () => [
        { id: 293, name: 'A key', count: 2 },
        { id: 298, name: 'A key', count: 1 }
    ];
    (Inventory as any).items = () => [
        { id: 293, name: 'A key', count: 1 },
        { id: 298, name: 'A key', count: 1 },
        { id: 954, name: 'Rope', count: 1 }
    ];
    (Equipment as any).items = () => [
        { id: 295, name: "Glarial's amulet", count: 1 }
    ];
    (Quests as any).status = () => 'started';
    (Game as any).tile = () => ({ x: 2565, z: 9915, level: 0 });
    (Inventory as any).free = () => 25;

    const engine = new QuestEngine({} as never);
    const internals = engine as unknown as {
        refreshBankCounts(acceptSettledEmpty?: boolean): void;
        buildSnapshot(module: QuestModule, stage?: number): QuestSnapshot;
    };
    internals.refreshBankCounts();
    bankOpen = false;
    const module = { record: { name: 'Waterfall Quest' } } as QuestModule;
    const snap = internals.buildSnapshot(module, 6);

    expect(snap.inv.get('a key')).toBe(2);
    expect(snap.invIds).toEqual(new Map([[293, 1], [298, 1], [954, 1]]));
    expect(snap.worn).toEqual(new Set(["glarial's amulet"]));
    expect(snap.wornIds).toEqual(new Set([295]));
    expect(snap.bank?.get('a key')).toBe(3);
    expect(snap.bankIds).toEqual(new Map([[293, 2], [298, 1]]));
    expect(snap.stage).toBe(6);
});
