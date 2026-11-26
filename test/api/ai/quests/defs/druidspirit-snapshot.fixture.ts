import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export interface NatureSpiritSnapshotOptions {
    stage: number;
    journal: QuestSnapshot['journal'];
    tile: QuestSnapshot['tile'];
    prayer?: number;
    flags?: string[];
    invIds?: [number, number][];
    bankIds?: [number, number][];
    wornIds?: number[];
    bankKnown?: boolean;
}

export function natureSpiritSnapshot({
    flags, invIds, bankIds, wornIds, bankKnown = true, ...scenario
}: NatureSpiritSnapshotOptions): QuestSnapshot {
    return {
        ...scenario,
        progress: { stage: scenario.stage, flags: new Set(flags) },
        inv: new Map(),
        invIds: new Map(invIds),
        worn: new Set(),
        wornIds: new Set(wornIds),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(bankIds),
        bankKnown,
        freeSlots: 20
    };
}
