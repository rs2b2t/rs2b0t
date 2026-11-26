import { CB_ID, CB_STAGE } from '#/bot/api/ai/quests/defs/chompybird/areas.js';
import { ARROW_TARGET } from '#/bot/api/ai/quests/defs/chompybird/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

export interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: [number, number][];
    inv?: [string, number][];
    bank?: [string, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    worn?: string[];
    wornIds?: number[];
    freeSlots?: number;
}

/** A pack that has already been through the bank: coins, food and an axe. */
export function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const stage = options.stage ?? CB_STAGE.NOT_STARTED;
    const inv = new Map<string, number>([
        ['coins', 2000],
        ['trout', 6],
        ['bronze axe', 1],
        ...(options.inv ?? [])
    ]);
    return {
        journal: options.journal ?? (stage === CB_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv,
        invIds: new Map([[CB_ID.FEATHER, ARROW_TARGET * 4], ...(options.invIds ?? [])]),
        worn: new Set(options.worn),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set<string>() },
        bank: new Map(options.bank ?? [['coins', 2_000_000]]),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: { x: 2630, z: 2981, level: 0 },
        freeSlots: options.freeSlots ?? 20
    };
}
