import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function snap(journal: QuestSnapshot['journal'], items: [string, number][] = [], bankCoins = 0): QuestSnapshot {
    return { journal, inv: new Map(items), worn: new Set(), noProgress: 0, bankCoins };
}
