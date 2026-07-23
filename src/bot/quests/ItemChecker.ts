import type { QuestRecord, BankInventorySnapshot, ItemResult } from './types.js';

function have(snapshot: BankInventorySnapshot, name: string): number {
    const wanted = name.toLowerCase();
    for (const [k, v] of snapshot.counts) {
        if (k.toLowerCase() === wanted) {
            return v;
        }
    }
    return 0;
}

export function checkItems(record: QuestRecord, snapshot: BankInventorySnapshot): ItemResult[] {
    return record.items.map(item => {
        const present = have(snapshot, item.name);
        if (item.kind === 'mustHave') {
            return { name: item.name, qty: item.qty, kind: item.kind, present, ok: present >= item.qty, willGather: false };
        }
        return { name: item.name, qty: item.qty, kind: item.kind, present, ok: true, willGather: present < item.qty };
    });
}
