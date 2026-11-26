import { questProgressAt, readQuestJournal, type JournalCache } from '../../journalReader.js';
import { matchJournal, normalizeJournal } from '../../journalText.js';
import type { QuestProgress } from '../../engine/types.js';
import { DIG_NAME } from './areas.js';

/** `%itexamlevel` never reaches the client as a varp, so these come off the rendered journal. */
export const DIG_STAGE = {
    NOT_STARTED: 0,
    STAMPING: 1,
    FIRST_EXAM: 2,
    SECOND_EXAM: 3,
    THIRD_EXAM: 4,
    IMPRESS_EXPERT: 5,
    MINESHAFT_PERMIT: 6,
    POURED_COMPOUND: 7,
    REMOVED_BLOCKAGE: 8,
    COMPLETE: 9
} as const;

// Why: Keep the leading space because "She gave me an answer" contains the other marker without it.

function normalize(lines: readonly string[] | string): string {
    return ' ' + normalizeJournal(lines);
}

// Why: earlier lines stay on the page struck through with the same words, so this order is what separates a finished leg from the current one.
const STAGES: readonly [string, number][] = [
    ['quest complete!', DIG_STAGE.COMPLETE],
    ['interesting find in the secret room', DIG_STAGE.REMOVED_BLOCKAGE],
    ['ignite the explosive compound', DIG_STAGE.POURED_COMPOUND],
    ['move the rocks blocking the way', DIG_STAGE.MINESHAFT_PERMIT],
    ['letter to a workman near a', DIG_STAGE.IMPRESS_EXPERT],
    ['study for my third exam', DIG_STAGE.THIRD_EXAM],
    ['study for my second exam', DIG_STAGE.SECOND_EXAM],
    ['study for my first exam', DIG_STAGE.FIRST_EXAM],
    ['curator of the varrock museum', DIG_STAGE.STAMPING],
    ['i can start this quest by speaking to', DIG_STAGE.NOT_STARTED]
];

/** The answered line is the same words for the green and the orange student, so each needle carries the line above it. */
const FLAGS: readonly [string, string][] = [
    ['i should talk to the examiner to take my', 'exam-ready'],
    ['green top about the exams. he gave me an answer', 'green-answered'],
    ['orange top about the exams. he gave me an answer', 'orange-answered'],
    ['she gave me an answer', 'purple-answered'],
    ['i need to bring her an opal', 'opal-wanted']
];

const ANSWERED_LINE = ' he gave me an answer';

function countOf(text: string, needle: string): number {
    let count = 0;
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + needle.length)) {
        count++;
    }
    return count;
}

export function parseDigsiteJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const progress = matchJournal(text, STAGES, FLAGS);
    if (!progress) {
        return undefined;
    }
    // Why: both answered lines read the same, so two of them is proof of both even if the pair ordering ever changes.
    if (countOf(text, ANSWERED_LINE) >= 2) {
        progress.flags.add('green-answered');
        progress.flags.add('orange-answered');
    }
    return progress;
}

/** A failed read doesn't mean the quest went backwards. */
const cache: JournalCache<QuestProgress> = {};

/** Test seam: the last good page is memoised for the process. */
export function resetDigsiteJournalCache(): void {
    cache.lastGood = undefined;
}

export function readDigsiteProgress(): Promise<QuestProgress | undefined> {
    return readQuestJournal(DIG_NAME, DIG_STAGE, parseDigsiteJournal, questProgressAt, cache);
}
