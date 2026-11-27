import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function equippedDisguiseSnapshot(stage: number): QuestSnapshot {
    return {
        journal: 'inProgress',
        stage,
        inv: new Map([['cabbage', 1]]),
        worn: new Set(['iron chainbody', 'bronze med helm']),
        noProgress: 0,
        bankCoins: 0
    };
}
