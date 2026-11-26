import { SC_STAGE } from '#/bot/api/ai/quests/defs/scorpcatcher/areas.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

import { itemCounts } from '../../../../lib/questSteps.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    noProgress?: boolean;
    invIds?: number[];
    bankIds?: number[];
    bankKnown?: boolean;
}

export function snap(options: Options = {}): QuestSnapshot {
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(),
        invIds: itemCounts(options.invIds ?? []),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 5000,
        progress: options.noProgress ? undefined : { stage: options.stage ?? SC_STAGE.FIRST_HINT, flags: new Set() },
        bank: new Map(),
        bankIds: itemCounts(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 20
    };
}
