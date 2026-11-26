import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export const snap = (
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [],
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    ...extra
});
