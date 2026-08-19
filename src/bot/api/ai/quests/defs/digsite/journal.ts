import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { DIG_NAME } from './areas.js';

/** `%itexamlevel`, which the client never sees as a varp — these come off the rendered journal. */
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

// Why: the leading space is load-bearing — the purple student's "She gave me an answer" contains the green and orange students' "he gave me an answer", and without a word boundary one answered errand reads as two.

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return ' ' + (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: every earlier line stays on the page struck through, and its words do not change when it does, so this order is the only thing separating a finished leg from the current one.
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
    if (text.length === 0) {
        return undefined;
    }
    const hit = STAGES.find(([needle]) => text.includes(needle));
    if (!hit) {
        return undefined;
    }
    const flags = new Set<string>();
    for (const [needle, flag] of FLAGS) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    // Why: both answered lines read the same, so two of them is proof of both even if the pair ordering ever changes.
    if (countOf(text, ANSWERED_LINE) >= 2) {
        flags.add('green-answered');
        flags.add('orange-answered');
    }
    return { stage: hit[1], flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

/** Test seam: the last good page is memoised for the process. */
export function resetDigsiteJournalCache(): void {
    lastGood = undefined;
}

export async function readDigsiteProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(DIG_NAME);
    if (status === 'complete') return { stage: DIG_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: DIG_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseDigsiteJournal(await Quests.journal(DIG_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
