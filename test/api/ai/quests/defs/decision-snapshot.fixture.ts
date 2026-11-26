import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function decisionSnapshot(defaultTile: WorldTile, overrides: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: overrides.journal ?? 'inProgress',
        inv: overrides.inv ?? new Map(),
        invIds: overrides.invIds ?? new Map(),
        worn: overrides.worn ?? new Set(),
        wornIds: overrides.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: overrides.bankCoins ?? 0,
        stage: overrides.stage ?? overrides.progress?.stage,
        progress: overrides.progress,
        bank: overrides.bank ?? new Map(),
        bankIds: overrides.bankIds ?? new Map(),
        bankKnown: overrides.bankKnown ?? true,
        tile: overrides.tile === undefined ? defaultTile : overrides.tile,
        freeSlots: overrides.freeSlots ?? 28
    };
}
