import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type GroundItemSnapshot, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SM_ID, SM_TILE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Input } from '#/bot/input/Input.js';
import { prepareSerum } from '#/bot/scripts/ShadesOfMortton/serum.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';

afterEach(() => mock.restore());

const item = (id: number, slot: number, count = 1): InvItemSnapshot => ({ id, slot, count, comId: 3214, name: '', ops: [] });

function fixture() {
    const state = {
        pack: [item(1514, 0, 40), item(SM_ID.TARROMIN_UNF, 1), item(SM_ID.TINDERBOX, 2), item(1513, 3)],
        ground: [] as GroundItemSnapshot[], event: false, burning: false, ticks: 0
    };
    const supply = new Supplies(() => {});
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'groundItems').mockImplementation(() => state.ground);
    spyOn(reader, 'toLocal').mockImplementation((lx, lz) => ({ lx, lz }));
    spyOn(Bank, 'isOpen').mockReturnValue(false);
    spyOn(supply, 'bank').mockRejectedValue(new Error('Local serum must not bank'));
    spyOn(supply, 'combatReady').mockResolvedValue(true);
    spyOn(supply, 'walk').mockResolvedValue(true);
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => {
        state.ticks += n;
        if (state.burning && state.ticks >= 3) state.ground = [{ id: SM_ID.ASHES, name: 'Ashes', count: 1, tile: SM_TILE.TOWN, distance: 1, ops: ['Take'] }];
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        for (let i = 0; i < 6; i++) { if (condition()) return true; await Execution.delayTicks(1); }
        return condition();
    });
    spyOn(Input, 'takeObj').mockImplementation((_x, _z, id) => {
        state.pack.push(item(id, 10));
        state.ground = [];
        return true;
    });
    spyOn(Input, 'useItemOnItem').mockImplementation((id, _slot, _com, target) => {
        if (id === SM_ID.TINDERBOX && target === 1513) {
            state.pack = state.pack.filter(i => i.id !== 1513);
            state.burning = true;
        } else if (id === SM_ID.ASHES && target === SM_ID.TARROMIN_UNF) {
            state.pack = state.pack.filter(i => i.id !== SM_ID.ASHES);
            state.pack.find(i => i.id === SM_ID.TARROMIN_UNF)!.id = SM_ID.SERUM3;
        } else return false;
        return true;
    });
    return { state, supply };
}

test('local serum burns a carried loose magic log and preserves noted expedition logs', async () => {
    const { supply } = fixture();
    expect(await prepareSerum(supply, false)).toBe(true);
    expect(Inventory.countById(SM_ID.SERUM3)).toBe(1);
    expect(Inventory.countById(1514)).toBe(40);
    expect(Inventory.countById(1513)).toBe(0);
    expect(supply.bank).not.toHaveBeenCalled();
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
});

test('local serum uses nearby ashes without consuming a loose log', async () => {
    const { state, supply } = fixture();
    state.ground = [{ id: SM_ID.ASHES, name: 'Ashes', count: 1, tile: SM_TILE.TOWN, distance: 1, ops: ['Take'] }];
    expect(await prepareSerum(supply, false)).toBe(true);
    expect(Inventory.countById(1513)).toBe(1);
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
});

test('local serum with no ashes or loose logs stops without leaving Mortton', async () => {
    const { state, supply } = fixture();
    state.pack = state.pack.filter(i => i.id !== 1513);
    expect(await prepareSerum(supply, false)).toBe(false);
    expect(Inventory.countById(1514)).toBe(40);
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
});

test('local serum keeps the pack intact when four preparation slots are unavailable', async () => {
    const { state, supply } = fixture();
    while (state.pack.length < 25) state.pack.push(item(8000 + state.pack.length, state.pack.length));
    expect(await prepareSerum(supply, false)).toBe(false);
    expect(Inventory.countById(1513)).toBe(1);
    expect(supply.bank).not.toHaveBeenCalled();
});

test('local serum yields to an event while waiting for its fire to leave ashes', async () => {
    const { state, supply } = fixture();
    spyOn(Execution, 'delayTicks').mockImplementation(async () => { state.event = true; });
    expect(await prepareSerum(supply, false)).toBe(false);
    expect(Inventory.countById(SM_ID.TARROMIN_UNF)).toBe(1);
    expect(Inventory.countById(1514)).toBe(40);
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
});

test('local serum resumes waiting for an interrupted fire without another loose log', async () => {
    const { state, supply } = fixture();
    spyOn(Execution, 'delayTicks').mockImplementation(async () => { state.event = true; });
    expect(await prepareSerum(supply, false)).toBe(false);
    state.event = false;
    spyOn(Execution, 'delayTicks').mockImplementation(async () => {
        state.ground = [{ id: SM_ID.ASHES, name: 'Ashes', count: 1, tile: SM_TILE.TOWN, distance: 1, ops: ['Take'] }];
    });
    expect(await prepareSerum(supply, false)).toBe(true);
    expect(Inventory.countById(SM_ID.SERUM3)).toBe(1);
    expect(Inventory.countById(1514)).toBe(40);
});
