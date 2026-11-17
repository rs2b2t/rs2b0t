import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Input } from '#/bot/input/Input.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';

afterEach(() => mock.restore());

const item = (id: number, slot: number, count = 1): InvItemSnapshot => ({ id, slot, count, comId: 3214, name: '', ops: ['Drop'] });

function fixture() {
    const state = { pack: [item(1514, 0, 40), item(1513, 1), item(1513, 2), item(3432, 3), item(3432, 4), item(3434, 5)], event: false };
    const supply = new Supplies(() => {});
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    const bank = spyOn(supply, 'bank').mockRejectedValue(new Error('Dousing must preserve the expedition pack'));
    spyOn(Input, 'useItemOnItem').mockImplementation((id, slot, _com, targetId, targetSlot) => {
        const first = state.pack.find(i => i.slot === slot)!;
        const second = state.pack.find(i => i.slot === targetSlot)!;
        if (id === 3430 && targetId === 1513) {
            first.id = 229;
            second.id = 3448;
        } else {
            const doses = (3438 - id) / 2 + (3438 - targetId) / 2;
            first.id = doses > 4 ? 3438 - (doses - 4) * 2 : 229;
            second.id = 3438 - Math.min(doses, 4) * 2;
        }
        return true;
    });
    spyOn(Input, 'heldOp').mockImplementation((id, slot) => {
        state.pack = state.pack.filter(i => i.slot !== slot || i.id !== id);
        return true;
    });
    return { state, supply, bank };
}

test('local dousing combines partial oil, makes the requested logs, and clears only empty vials', async () => {
    const { supply, bank } = fixture();
    expect(await supply.douse(2)).toBe(true);
    expect(Inventory.countById(3448)).toBe(2);
    expect(Inventory.countById(1514)).toBe(40);
    expect(Inventory.countById(229)).toBe(0);
    expect(bank).not.toHaveBeenCalled();
});

test('local dousing cannot treat accepted input without a new pyre log as success', async () => {
    const { state, supply } = fixture();
    state.pack = [item(3430, 0), item(1513, 1)];
    spyOn(Input, 'useItemOnItem').mockReturnValue(true);
    expect(await supply.douse(1)).toBe(false);
    expect(Inventory.countById(1513)).toBe(1);
});

test('local dousing stops after an event during the first log', async () => {
    const { state, supply } = fixture();
    state.pack = [item(3430, 0), item(1513, 1), item(3430, 2), item(1513, 3)];
    const use = spyOn(Input, 'useItemOnItem').mockImplementation(() => {
        state.pack[0].id = 229;
        state.pack[1].id = 3448;
        state.event = true;
        return true;
    });
    expect(await supply.douse(2)).toBe(false);
    expect(use).toHaveBeenCalledTimes(1);
    expect(Inventory.countById(3448)).toBe(1);
});

test('empty vial cleanup fails when accepted drop input leaves the item in inventory', async () => {
    const { state, supply } = fixture();
    state.pack.push(item(229, 6));
    const drop = spyOn(Input, 'heldOp').mockReturnValue(true);
    expect(await supply.clearVials()).toBe(false);
    expect(drop).toHaveBeenCalledTimes(1);
    expect(Inventory.countById(229)).toBe(1);
});
