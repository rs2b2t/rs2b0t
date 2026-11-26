import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export const COINS = 995;

export interface BankOptions {
    bankIds?: [number, number][];
    bankKnown?: boolean;
    tile?: QuestSnapshot['tile'];
}

export function knightsSwordSnapshot(options: BankOptions & {
    journal: QuestSnapshot['journal'];
    defaultCoins: number;
    inv?: [string, number][];
    invIds?: [number, number][];
    wornIds?: number[];
}): QuestSnapshot {
    return {
        journal: options.journal,
        inv: new Map(options.inv),
        invIds: new Map([[COINS, options.defaultCoins], ...(options.invIds ?? [])]),
        worn: new Set(),
        wornIds: new Set(options.wornIds),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(options.bankIds),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? { x: 2946, z: 3369, level: 0 },
        freeSlots: 20
    };
}
