import { readQuestJournal, type JournalCache } from '../../journalReader.js';
import { normalizeJournal as normalize } from '../../journalText.js';
// docs/QUESTS.md
import { IKOV_QUEST } from './areas.js';

/** `%ikov`. 20 and 30 render the same page, so the module folds them into `PULLED_LEVER`. */
export const IKOV_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    PULLED_LEVER: 30,
    KILLED_WARRIOR: 40,
    SPOKEN_WINELDA: 50,
    PAID_WINELDA: 60,
    HELPING_ARMADYL: 70,
    COMPLETE: 100
} as const;

/** Colour tags become a space, so no needle may span a tag boundary. */
// Why: earlier lines stay on the page struck through, so an early needle still matches late and the order is what separates them.
const STAGES: readonly [string, number][] = [
    ['quest complete!', IKOV_STAGE.COMPLETE],
    ['guardians of armadyl', IKOV_STAGE.HELPING_ARMADYL],
    ['winelda teleported me across', IKOV_STAGE.PAID_WINELDA],
    ['will teleport me across', IKOV_STAGE.SPOKEN_WINELDA],
    ['i killed it using arrows made of ice', IKOV_STAGE.KILLED_WARRIOR],
    ['i found a trap on a', IKOV_STAGE.PULLED_LEVER],
    ['he has given me a pendant so i can enter the', IKOV_STAGE.STARTED],
    ['i can start this quest at the', IKOV_STAGE.NOT_STARTED]
];

export function parseIkovJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    return STAGES.find(([needle]) => text.includes(needle))?.[1];
}

/** Stands in when a read fails. */
const cache: JournalCache<number> = {};

export function readIkovStage(): Promise<number | undefined> {
    return readQuestJournal(IKOV_QUEST, IKOV_STAGE, parseIkovJournal, stage => stage, cache);
}
