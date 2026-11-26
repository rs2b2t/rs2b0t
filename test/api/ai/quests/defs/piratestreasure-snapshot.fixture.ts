import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export const pirateSnapshot = (over: Partial<QuestSnapshot> = {}): QuestSnapshot => ({
    journal: 'inProgress',
    inv: new Map(),
    invIds: new Map(),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(),
    bankKnown: true,
    ...over
});
