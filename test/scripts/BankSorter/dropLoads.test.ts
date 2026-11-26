import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import BankSorter from '#/bot/scripts/BankSorter/BankSorter.js';

afterEach(() => mock.restore());

function item(id: number, slot: number, count = 1): InvItemSnapshot {
    return { id, name: 'Key', slot, count, comId: 3214, ops: [null, null, null, null, 'Drop'] };
}

function fixture(quantities: number[], rejectedSlot = -1) {
    const sorter = new BankSorter();
    sorter['sort'] = false;
    sorter.bindLog(() => {});
    const pack = new Map<number, InvItemSnapshot>([[0, item(99, 0)]]);
    const bank = new Map(quantities.map((count, i) => [i + 1, count]));
    const stackId = 3;
    let open = true;
    let tick = 0;
    const clicks: number[][] = [];
    const queued: number[] = [];
    const loads: number[] = [];
    const advance = () => {
        for (const slot of queued.splice(0)) pack.delete(slot);
        tick++;
    };
    spyOn(Bank, 'isOpen').mockImplementation(() => open);
    spyOn(Bank, 'waitReady').mockImplementation(async () => open);
    spyOn(Bank, 'backpackReady').mockImplementation(async () => open);
    spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'objCatalog').mockReturnValue(quantities.map((_, i) => ({
        id: i + 1, name: 'Key', stackable: i + 1 === stackId, cost: 1,
        members: false, equippable: false, certlink: -1, certtemplate: -1
    })));
    spyOn(reader, 'inventorySnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankComId').mockImplementation(() => open ? 1 : -1);
    spyOn(reader, 'bankSideItems').mockImplementation(() => [...pack.values()]);
    spyOn(reader, 'inventory').mockImplementation(() => [...pack.values()]);
    spyOn(reader, 'bankItems').mockImplementation(() => [...bank].filter(([, n]) => n > 0).map(([id, n], i) => item(id, i, n)));
    spyOn(Bank, 'withdrawLoad').mockImplementation(async id => {
        if (!open) throw new Error('withdraw while closed');
        const key = Number(id);
        let n = bank.get(key) ?? 0;
        for (let slot = 0; slot < 28 && n > 0; slot++) {
            if (pack.has(slot)) continue;
            const amount = key === stackId ? n : 1;
            pack.set(slot, item(key, slot, amount));
            n -= amount;
        }
        bank.set(key, n);
        return true;
    });
    spyOn(Bank, 'close').mockImplementation(async () => { loads.push(pack.size - 1); open = false; return true; });
    const reopen = spyOn(Banking, 'open').mockImplementation(async () => { open = true; return true; });
    spyOn(Input, 'heldOp').mockImplementation((id, slot) => {
        if (open || pack.get(slot)?.id !== id || slot === 0) throw new Error('unexpected drop');
        (clicks[tick] ??= []).push(slot);
        if (slot !== rejectedSlot) queued.push(slot);
        return true;
    });
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { for (let i = 0; i < n; i++) advance(); });
    spyOn(Execution, 'delayUntil').mockImplementation(async cond => {
        for (let i = 0; i < 5 && !cond(); i++) advance();
        return cond();
    });
    const findings = quantities.map((_, i) => ({ id: i + 1, name: 'Key', quest: 'A Quest', status: 'complete' as const, droppable: true }));
    return { sorter, run: () => sorter['dropAll'](findings), pack, bank, clicks, loads, reopen };
}

test('fills the pack across IDs, confirms five drops per tick and drains a second load', async () => {
    const f = fixture([13, 20, 400]);
    expect(await f.run()).toBe(433);
    expect(f.loads).toEqual([27, 7]);
    expect(f.clicks.filter(Boolean).map(clicks => clicks.length)).toEqual([5, 5, 5, 5, 5, 2, 5, 2]);
    expect([...f.pack.keys()]).toEqual([0]);
    expect([...f.bank.values()]).toEqual([0, 0, 0]);
    expect(f.reopen).toHaveBeenCalledTimes(1);
});

test('a refused drop is bounded and is excluded from the disposal count', async () => {
    const f = fixture([8], 1);
    expect(await f.run()).toBe(7);
    expect([...f.pack.keys()]).toEqual([0, 1]);
    expect(f.clicks.flat().filter(slot => slot === 1).length).toBeLessThanOrEqual(3);
});

test('preserves carried copies and skips withdrawals that would merge into a carried stack', async () => {
    const f = fixture([3, 0, 20]);
    f.pack.set(1, item(1, 1));
    f.pack.set(4, item(3, 4, 7));
    expect(await f.run()).toBe(3);
    expect([...f.pack.values()]).toEqual([item(99, 0), item(1, 1), item(3, 4, 7)]);
    expect(f.bank.get(3)).toBe(20);
});

test('leaves a full backpack alone', async () => {
    const f = fixture([5]);
    for (let slot = 1; slot < 28; slot++) f.pack.set(slot, item(99, slot));
    expect(await f.run()).toBe(0);
    expect(Bank.withdrawLoad).not.toHaveBeenCalled();
    expect(f.clicks).toEqual([]);
});

test('reopens the bank after the final load when sorting is enabled', async () => {
    const f = fixture([2]);
    f.sorter['sort'] = true;
    expect(await f.run()).toBe(2);
    expect(f.reopen).toHaveBeenCalledTimes(1);
    expect(Bank.isOpen()).toBe(true);
});
