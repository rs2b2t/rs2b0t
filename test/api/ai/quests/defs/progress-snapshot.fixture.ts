import { itemCounts, nameCounts } from '../../../../lib/questSteps.js';
import type { QuestProgress, QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export interface ProgressSnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    progress?: QuestSnapshot['progress'];
    inv?: string[];
    invIds?: number[];
    bank?: string[];
    bankKnown?: boolean;
}

export function progressSnapshot(options: ProgressSnapshotOptions, defaultProgress: () => QuestProgress): QuestSnapshot {
    const progress = 'progress' in options ? options.progress : defaultProgress();
    return {
        journal: options.journal ?? 'inProgress',
        inv: nameCounts(options.inv ?? []),
        invIds: itemCounts(options.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: nameCounts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 28
    };
}
