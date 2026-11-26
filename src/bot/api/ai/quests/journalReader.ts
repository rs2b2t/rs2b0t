import { Quests } from '../../ui/questlog/Quests.js';
import { Modals } from '../../ui/widgets/Modals.js';
import type { QuestProgress } from './engine/types.js';

export interface JournalCache<T> {
    lastGood?: T;
}

export function questProgressAt(stage: number): QuestProgress {
    return { stage, flags: new Set() };
}

export async function readQuestJournal<T>(
    name: string,
    stages: { COMPLETE: number; NOT_STARTED: number },
    parse: (lines: string[]) => T | undefined,
    atStage: (stage: number) => T,
    cache?: JournalCache<T>,
    { readNotStarted = false } = {}
): Promise<T | undefined> {
    const status = Quests.status(name);
    if (status === 'complete') return atStage(stages.COMPLETE);
    if (status === 'notStarted' && !readNotStarted) return atStage(stages.NOT_STARTED);
    if (status !== 'inProgress' && status !== 'notStarted') return undefined;

    const result = parse(await Quests.journal(name));
    // Why: the journal body is a main modal, and leaving it up makes every later read come back empty.
    await Modals.closeIfOpen();
    if (cache && result !== undefined) cache.lastGood = result;
    return result ?? (status === 'notStarted' ? atStage(stages.NOT_STARTED) : cache?.lastGood);
}
