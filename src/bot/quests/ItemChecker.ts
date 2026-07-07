import type { QuestRecord, BankInventorySnapshot, ItemResult } from './types.js';

/** Case-insensitive lookup into the snapshot's name->qty map. */
function have(snapshot: BankInventorySnapshot, name: string): number {
    const wanted = name.toLowerCase();
    for (const [k, v] of snapshot.counts) {
        if (k.toLowerCase() === wanted) {
            return v;
        }
    }
    return 0;
}

/**
 * Evaluate a quest's items against a bank+inventory snapshot. Pure. mustHave
 * items require present >= qty; acquirable items never block (willGather marks
 * the ones not yet in hand).
 */
export function checkItems(record: QuestRecord, snapshot: BankInventorySnapshot): ItemResult[] {
    return record.items.map(item => {
        const present = have(snapshot, item.name);
        if (item.kind === 'mustHave') {
            return { name: item.name, qty: item.qty, kind: item.kind, present, ok: present >= item.qty, willGather: false };
        }
        return { name: item.name, qty: item.qty, kind: item.kind, present, ok: true, willGather: present < item.qty };
    });
}
