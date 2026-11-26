import { expect, test } from 'bun:test';
import { bankedItem, heldItem, wornItem } from '#/bot/api/ai/quests/engine/snapshotItems.js';
import { bankedId, type QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import * as family from '#/bot/api/ai/quests/defs/familycrest/supplies.js';
import * as murder from '#/bot/api/ai/quests/defs/murder/state.js';
import * as plague from '#/bot/api/ai/quests/defs/plaguecity/areas.js';
import * as biohazard from '#/bot/api/ai/quests/defs/biohazard/areas.js';

function snapshot(): QuestSnapshot {
    return { journal: 'unknown', inv: new Map([['key', 4]]), worn: new Set(['key']), noProgress: 0, bankCoins: 0 };
}

test('named item lookups use the first read of each ID collection', () => {
    const counts = new Map([[1, 3]]);
    const inventory = [counts, new Map<number, number>()];
    const bank = [counts, new Map<number, number>()];
    const worn = [new Set([1]), new Set<number>()];
    const snap = {
        ...snapshot(),
        bankKnown: false,
        get invIds() { return inventory.shift(); },
        get bankIds() { return bank.shift(); },
        get wornIds() { return worn.shift(); },
    };
    const item = { id: 1, name: 'Key' };
    expect([heldItem(snap, item), bankedItem(snap, item), wornItem(snap, item)]).toEqual([3, 3, true]);
    expect([inventory.length, bank.length, worn.length]).toEqual([1, 1, 1]);
});

test('quests can read cached bank counts independently of the bank-known flag', () => {
    const snap = snapshot();
    snap.bankIds = new Map([[1, 3]]);
    snap.bank = new Map([['key', 9]]);
    snap.bankKnown = false;
    expect(bankedId(snap, 1)).toBe(0);
    expect(murder.banked(snap, 1)).toBe(0);
    expect(family.banked(snap, 1)).toBe(3);
    expect(family.bankedName(snap, 'Key')).toBe(9);
    expect(family.held(snap, 1)).toBe(0);
    expect(family.heldName(snap, 'KEY')).toBe(4);
    snap.bankKnown = true;
    expect(murder.banked(snap, 1)).toBe(3);
});

test('a guarded bank lookup skips the cache until the bank is known', () => {
    const snap = snapshot();
    Object.defineProperty(snap, 'bankIds', { get() { throw new Error('unexpected bank read'); } });
    expect(murder.banked(snap, 1)).toBe(0);
});

test('missing ID collections skip item getters and equipped ownership follows each quest', () => {
    const snap = snapshot();
    let reads = 0;
    const item = { name: 'Key', get id() { return ++reads; } };
    expect(plague.owned(snap, item)).toBe(0);
    expect(biohazard.owned(snap, item)).toBe(0);
    expect(reads).toBe(0);
    snap.invIds = new Map([[1, 2]]);
    snap.bankIds = new Map([[2, 3]]);
    snap.wornIds = new Set([3]);
    expect(plague.owned(snap, item)).toBe(5);
    expect(reads).toBe(2);
    reads = 0;
    expect(biohazard.owned(snap, item)).toBe(6);
    expect(reads).toBe(3);
});
