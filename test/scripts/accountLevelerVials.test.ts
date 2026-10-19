import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { fillSupplyVials, VIAL_FOUNTAIN } from '#/bot/scripts/AccountLeveler/vials.js';

afterEach(() => mock.restore());

function fixture() {
    const pack: InvItemSnapshot[] = Array.from({ length: 3 }, (_, slot) => ({ id: 229, name: 'Vial', slot, count: 1, comId: 3214, ops: ['Use'] }));
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'locs').mockReturnValue([{ id: 512, name: 'Fountain', typecode: 2, ops: [], tile: VIAL_FOUNTAIN, distance: 1 }]);
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    const wait = spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    const ticks = spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const use = spyOn(InvItem.prototype, 'useOn').mockImplementation(async function(this: InvItem) {
        pack[this.slot] = { ...pack[this.slot], id: 227, name: 'Vial of water' };
        return true;
    });
    return { pack, walk, wait, ticks, use };
}

test('fills exactly the requested vials and waits between protected operations', async () => {
    const f = fixture();
    expect(await fillSupplyVials(2, () => {})).toBe(true);
    expect(f.pack.map(item => item.id)).toEqual([227, 227, 229]);
    expect(f.walk).toHaveBeenCalledWith(VIAL_FOUNTAIN, expect.objectContaining({ timeoutMs: 120000 }));
    expect(f.use).toHaveBeenCalledTimes(2);
    expect(f.ticks).toHaveBeenCalledTimes(2);
});

test.each(['no change', 'empty disappears', 'water appears'])('filling stops on %s instead of claiming success', async failure => {
    const f = fixture();
    f.use.mockImplementation(async () => {
        if (failure === 'empty disappears') f.pack.pop();
        if (failure === 'water appears') f.pack.push({ ...f.pack[0], id: 227, name: 'Vial of water' });
        return true;
    });
    expect(await fillSupplyVials(3, () => {})).toBe(false);
    expect(f.use).toHaveBeenCalledTimes(1);
    expect(f.wait).toHaveBeenCalledWith(expect.any(Function), 4000);
});

test('unreachable fountain does not attempt item use', async () => {
    const f = fixture();
    f.walk.mockResolvedValue(false);
    expect(await fillSupplyVials(3, () => {})).toBe(false);
    expect(f.use).not.toHaveBeenCalled();
});

test('noted vials are never used on the fountain', async () => {
    const f = fixture();
    for (const item of f.pack) item.noted = true;
    expect(await fillSupplyVials(3, () => {})).toBe(false);
    expect(f.use).not.toHaveBeenCalled();
});
