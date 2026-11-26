import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function heroSnapshot(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: { x: 3210, z: 3490, level: 0 },
        freeSlots: 20,
        ...over
    };
}
