import { questProgressAt, readQuestJournal, type JournalCache } from '../../journalReader.js';
import { matchJournal, normalizeJournal as normalize } from '../../journalText.js';
import type { QuestProgress } from '../../engine/types.js';
import { MURDER_NAME } from './areas.js';

export const MURDER_STAGE = { NOT_STARTED: 0, STARTED: 1, COMPLETE: 2 } as const;

/** The 3 evidence lines the page adds one at a time. */
export const POISON_PROVED = 'poison-proved';
export const THREAD_FOUND = 'thread';
export const WEAPON_TAKEN = 'weapon';

const STAGES: readonly [string, number][] = [
    ['quest complete!', MURDER_STAGE.COMPLETE],
    ['lord sinclair, a prominent nobleman', MURDER_STAGE.STARTED],
    ['i can start this quest by speaking to', MURDER_STAGE.NOT_STARTED]
];

const FLAGS: readonly [string, string][] = [
    ['indisputable evidence', POISON_PROVED],
    ['i have found some coloured thread', THREAD_FOUND],
    ['i have taken the murder weapon', WEAPON_TAKEN]
];

export function parseMurderJournal(lines: readonly string[] | string): QuestProgress | undefined {
    return matchJournal(normalize(lines), STAGES, FLAGS);
}

// Why: the page drops every in-progress line once the poison is proved, so a stale read doesn't mean the quest went backwards.
const cache: JournalCache<QuestProgress> = {};

export function readMurderProgress(): Promise<QuestProgress | undefined> {
    return readQuestJournal(MURDER_NAME, MURDER_STAGE, parseMurderJournal, questProgressAt, cache);
}

/** Test seam: the last good read is memoised for the process. */
export function resetMurderProgressCache(): void {
    cache.lastGood = undefined;
}
