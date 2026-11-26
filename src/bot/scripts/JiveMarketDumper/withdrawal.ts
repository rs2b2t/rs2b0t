import { reader } from '../../adapter/ClientAdapter.js';
import { Bank, withdrawOp } from '../../api/bank/Bank.js';
import { Execution } from '../../api/execution/Execution.js';
import { itemCounts, type Dumpable } from './logic.js';

const ROWS_PER_BATCH = 5;

export async function withdrawPile(pile: readonly Dumpable[]): Promise<boolean> {
    if (!(await Bank.backpackReady())) return false;
    const targets = pile.map(line => ({ id: line.id, packId: line.notedId ?? line.id, count: line.count }));
    let misses = 0;
    while (Bank.ready() && reader.bankSideSnapshotReady() && misses < 3) {
        const held = itemCounts(reader.bankSideItems());
        const pending = targets.filter(row => (held.get(row.packId) ?? 0) !== row.count);
        if (!pending.length) return true;

        const stock = new Map(Bank.items().map(item => [item.id, item]));
        const batch: typeof targets = [];
        for (const row of pending.slice(0, ROWS_PER_BATCH)) {
            const missing = row.count - (held.get(row.packId) ?? 0);
            const item = stock.get(row.id);
            if (missing <= 0 || !item || item.count < missing) return false;
            const all = item.count === missing && withdrawOp(item.ops, 'all');
            if (!all) {
                if (!batch.length) {
                    if (!(await Bank.withdrawXById(row.id, missing, row.packId))) return false;
                    if (itemCounts(reader.bankSideItems()).get(row.packId) !== row.count) return false;
                    misses = 0;
                }
                break;
            }
            await Bank.withdrawById(row.id, all);
            batch.push(row);
        }

        if (!batch.length) continue;
        await Execution.delayUntilTicks(() => {
            if (!Bank.isOpen()) return true;
            const pack = itemCounts(reader.bankSideItems());
            return batch.every(row => pack.get(row.packId) === row.count);
        }, 2);
        const after = itemCounts(reader.bankSideItems());
        const progressed = batch.some(row => (after.get(row.packId) ?? 0) > (held.get(row.packId) ?? 0));
        misses = progressed ? 0 : misses + 1;
    }
    return false;
}
