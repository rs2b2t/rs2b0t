import { expect, test } from 'bun:test';

import { checkItems } from '#/bot/quests/ItemChecker.js';
import type { QuestRecord, BankInventorySnapshot } from '#/bot/quests/types.js';

function rec(items: QuestRecord['items']): QuestRecord {
    return { id: 't', name: 'T', questPoints: 1, requirements: {}, items };
}
function snap(entries: [string, number][] = []): BankInventorySnapshot {
    return { counts: new Map(entries) };
}

test('no items yields no results', () => {
    expect(checkItems(rec([]), snap())).toEqual([]);
});

test('mustHave present in sufficient qty is ok', () => {
    const r = rec([{ name: 'Iron bar', qty: 2, kind: 'mustHave' }]);
    const res = checkItems(r, snap([['Iron bar', 2]]));
    expect(res[0]).toEqual({ name: 'Iron bar', qty: 2, kind: 'mustHave', present: 2, ok: true, willGather: false });
});

test('mustHave with insufficient qty fails', () => {
    const r = rec([{ name: 'Iron bar', qty: 2, kind: 'mustHave' }]);
    const res = checkItems(r, snap([['Iron bar', 1]]));
    expect(res[0].ok).toBe(false);
    expect(res[0].present).toBe(1);
});

test('mustHave absent fails with present 0', () => {
    const res = checkItems(rec([{ name: 'Redberry pie', qty: 1, kind: 'mustHave' }]), snap());
    expect(res[0].ok).toBe(false);
    expect(res[0].present).toBe(0);
});

test('acquirable never blocks and flags willGather when absent', () => {
    const r = rec([{ name: 'Egg', qty: 1, kind: 'acquirable' }]);
    const absent = checkItems(r, snap());
    expect(absent[0].ok).toBe(true);
    expect(absent[0].willGather).toBe(true);
    const present = checkItems(r, snap([['Egg', 1]]));
    expect(present[0].ok).toBe(true);
    expect(present[0].willGather).toBe(false);
});

test('name match is case-insensitive', () => {
    const r = rec([{ name: 'Iron bar', qty: 1, kind: 'mustHave' }]);
    expect(checkItems(r, snap([['iron bar', 3]]))[0].ok).toBe(true);
});
