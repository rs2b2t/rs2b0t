import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function arravSnapshot(
    tile: WorldTile,
    stage: number,
    flags: string[] = [],
    invIds: [number, number][] = [],
    bankIds: [number, number][] = [],
    bankKnown = true
): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(invIds),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(bankIds),
        bankKnown,
        tile,
        freeSlots: 20,
        stage,
        progress: { stage, flags: new Set(flags) }
    };
}
