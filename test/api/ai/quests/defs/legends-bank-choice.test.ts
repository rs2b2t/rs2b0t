import { expect, test } from 'bun:test';

import { LQ_ID, LQ_ITEM } from '#/bot/api/ai/quests/defs/legends/areas.js';
import { fromBank } from '#/bot/api/ai/quests/defs/legends/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const snap = (bankIds: [number, number][]): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true
});

// Why: withdrawals use the nearest booth because every booth exposes the same bank contents.
test('a withdrawal names no bank, so the walker picks the nearest', () => {
    const step = fromBank(snap([[LQ_ID.LAW_RUNE, 20]]), { id: LQ_ID.LAW_RUNE, name: LQ_ITEM.LAW_RUNE }, 5);

    expect(step?.kind).toBe('withdraw');
    expect(step && 'bank' in step ? step.bank : undefined).toBeUndefined();
});
