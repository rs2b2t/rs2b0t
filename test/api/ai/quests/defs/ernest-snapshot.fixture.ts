import { EC_ID } from '#/bot/api/ai/quests/defs/ernest/areas.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export function ernestSnapshot(options: {
    journal: QuestSnapshot['journal'];
    food: number;
    invIds?: [number, number][];
    bank?: [string, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    tile?: QuestSnapshot['tile'];
}) {
    return {
        journal: options.journal,
        inv: new Map([['lobster', options.food]]),
        invIds: new Map(options.invIds ?? [[EC_ID.SPADE, 1]]),
        worn: new Set<string>(),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(options.bank),
        bankIds: new Map(options.bankIds),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? { x: 3093, z: 3243, level: 0 },
        freeSlots: 20
    } satisfies QuestSnapshot;
}
