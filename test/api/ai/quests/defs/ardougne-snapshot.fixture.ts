import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function ardougneSnapshot(
    overrides: Partial<QuestSnapshot>,
    purse: ReadonlyMap<number, number>,
    startingTile: WorldTile,
    noProgress: number
): QuestSnapshot {
    return {
        journal: overrides.journal ?? 'inProgress',
        inv: overrides.inv ?? new Map(),
        invIds: overrides.invIds ?? new Map(),
        worn: overrides.worn ?? new Set(),
        wornIds: overrides.wornIds ?? new Set(),
        noProgress,
        bankCoins: overrides.bankCoins ?? 0,
        stage: overrides.stage,
        progress: overrides.progress,
        bank: overrides.bank ?? new Map(),
        bankIds: overrides.bankIds ?? purse,
        bankKnown: overrides.bankKnown ?? true,
        tile: overrides.tile === undefined ? startingTile : overrides.tile,
        freeSlots: overrides.freeSlots ?? 28
    };
}
