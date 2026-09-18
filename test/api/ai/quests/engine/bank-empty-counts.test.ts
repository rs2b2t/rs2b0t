import { afterEach, expect, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { QuestEngine } from '#/bot/api/ai/quests/engine/QuestEngine.js';

const BANK_COM = 5382;

const originals = {
    bankComId: reader.bankComId,
    bankItems: reader.bankItems,
    bankSnapshotReady: reader.bankSnapshotReady
};

afterEach(() => {
    Object.assign(reader, originals);
});

interface Internals {
    refreshBankCounts(acceptSettledEmpty?: boolean): void;
    lastBankCounts: Map<string, number>;
    lastBankIdCounts: Map<number, number>;
}

test('a bank the quest drains to empty clears the counts, it does not keep the old ones', () => {
    let items: InvItemSnapshot[] = [
        { id: 995, name: 'Coins', count: 400, slot: 0, comId: BANK_COM, ops: [] }
    ];
    Object.assign(reader, {
        bankComId: () => BANK_COM,
        bankItems: () => items,
        bankSnapshotReady: () => true
    });

    const internals = new QuestEngine({} as never) as unknown as Internals;

    internals.refreshBankCounts();
    expect(internals.lastBankCounts.get('coins')).toBe(400);

    // The quest spends the lot. The bank still answers, and the answer is zero.
    items = [];
    internals.refreshBankCounts();

    expect(internals.lastBankCounts.get('coins')).toBeUndefined();
    expect(internals.lastBankIdCounts.get(995)).toBeUndefined();
});

test('a bank still transmitting keeps the last known counts', () => {
    const items: InvItemSnapshot[] = [
        { id: 995, name: 'Coins', count: 400, slot: 0, comId: BANK_COM, ops: [] }
    ];
    let arrived = true;
    Object.assign(reader, {
        bankComId: () => BANK_COM,
        bankItems: () => (arrived ? items : []),
        bankSnapshotReady: () => arrived
    });

    const internals = new QuestEngine({} as never) as unknown as Internals;
    internals.refreshBankCounts();
    expect(internals.lastBankCounts.get('coins')).toBe(400);

    arrived = false;
    internals.refreshBankCounts();

    expect(internals.lastBankCounts.get('coins')).toBe(400);
});
