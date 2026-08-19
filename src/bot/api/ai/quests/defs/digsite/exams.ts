import { Execution } from '../../../../execution/Execution.js';
import { Inventory } from '../../../../inventory/Inventory.js';
import { Modals } from '../../../../ui/widgets/Modals.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { settleScene } from '../../exec/prompts.js';
import { DIG_ID, DIG_LOC, DIG_NPC, DIG_TILE } from './areas.js';
import { driveUntilHeld, locByIdAction, talkToNpcId, useOnNpcId, walkTo } from './common.js';
import { DIG_STAGE } from './journal.js';

// Why: the exam presents the correct answer only for the questions whose student has been helped, so one list holds all nine and `pickPreferred` finds whichever is on screen.
// Why: the wrong-answer variants are deliberately absent — a doomed exam falls through to the driver's last-option fallback and fails, which costs nothing.

/** Every option the Examiner ever offers that this quest wants taken. */
export const EXAMINER_PREFER: readonly string[] = [
    'Can I take an exam?',
    'Yes, I certainly am.',
    'I am ready for the next exam.',
    'I am ready for the last exam',
    'I have lost the letter you gave me.',
    // Earth Sciences level 1
    'The study of the earth, its contents, and history.',
    'All that have passed the appropriate Earth Sciences exam.',
    'Gloves and boots to be worn at all times; proper tools must be used.',
    // Earth Sciences level 2
    'Samples taken in rough form; kept only in sealed containers.',
    'Finds must be carefully handled, and gloves worn.',
    'Always handle with care; strike cleanly on its cleaving point.',
    // Earth Sciences level 3
    'Samples cleaned, and carried only in specimen jars.',
    'Brush carefully and slowly using short strokes.',
    'Handle bones very carefully and keep them away from other samples.'
];

const TROWEL_PREFER: readonly string[] = ['I have lost my trowel.'];

export function talkToExaminer(name: string, prefer: readonly string[] = EXAMINER_PREFER): QuestStep {
    return {
        kind: 'custom',
        name,
        run: log => talkToNpcId(DIG_NPC.EXAMINER, DIG_TILE.EXAMINER, prefer, log, true)
    };
}

export function replaceTrowel(): QuestStep {
    return talkToExaminer('ask the Examiner for another trowel', TROWEL_PREFER);
}

/** The Curator stamps whatever letter is in the pack the moment the conversation opens. */
export function stampLetter(): QuestStep {
    return {
        kind: 'custom',
        name: 'have the Curator stamp the letter',
        run: async log => {
            if (!(await talkToNpcId(DIG_NPC.CURATOR, DIG_TILE.CURATOR, [], log))) {
                return false;
            }
            return driveUntilHeld(() => Inventory.countById(DIG_ID.STAMPED_LETTER) > 0, [], log);
        }
    };
}

/** The purple student's sample lies in one named bush at the edge of the site. */
export function searchBush(): QuestStep {
    return {
        kind: 'custom',
        name: "search the bush for the purple student's sample",
        run: async log => {
            if (Inventory.countById(DIG_ID.ROCK_SAMPLE_PURPLE) > 0) {
                return true;
            }
            if (!(await walkTo(DIG_TILE.BUSH_STAND, 1, log))) {
                return false;
            }
            await settleScene();
            const bush = locByIdAction([DIG_LOC.BUSH_SAMPLE], 'Search', 6);
            if (!bush) {
                log('no sample bush within six tiles of (3358,3372)');
                return false;
            }
            if (!(await bush.interact('Search'))) {
                return false;
            }
            return driveUntilHeld(() => Inventory.countById(DIG_ID.ROCK_SAMPLE_PURPLE) > 0, [], log, 15_000);
        }
    };
}

function deliver(itemId: number, npcId: number, label: string): QuestStep {
    return {
        kind: 'custom',
        name: label,
        run: log => useOnNpcId(itemId, npcId, DIG_TILE.STUDENTS, () => Inventory.countById(itemId) === 0, log)
    };
}

export const DELIVER_GREEN = (): QuestStep => deliver(DIG_ID.ROCK_SAMPLE_GREEN, DIG_NPC.STUDENT_GREEN, 'return the green student\'s rock sample');
export const DELIVER_PURPLE = (): QuestStep => deliver(DIG_ID.ROCK_SAMPLE_PURPLE, DIG_NPC.STUDENT_PURPLE, 'return the purple student\'s rock sample');
export const DELIVER_ORANGE = (): QuestStep => deliver(DIG_ID.ROCK_SAMPLE_ORANGE, DIG_NPC.STUDENT_ORANGE, 'return the orange student\'s rock sample');

// Why: from the second exam on one conversation with each student is the errand, and the purple student takes the third exam's opal through her own dialogue.
export function studyWithStudents(stage: number): QuestStep {
    const order = stage === DIG_STAGE.THIRD_EXAM
        ? [DIG_NPC.STUDENT_GREEN, DIG_NPC.STUDENT_ORANGE, DIG_NPC.STUDENT_PURPLE]
        : [DIG_NPC.STUDENT_GREEN, DIG_NPC.STUDENT_PURPLE, DIG_NPC.STUDENT_ORANGE];
    return {
        kind: 'custom',
        name: `revise with the three students for exam ${stage - 1}`,
        run: async log => {
            let spoke = 0;
            for (const npc of order) {
                if (await talkToNpcId(npc, DIG_TILE.STUDENTS, [], log)) {
                    spoke++;
                }
                await Modals.closeIfOpen();
                await Execution.delayTicks(1);
            }
            // Why: the purple student asks for the opal on the first pass and takes it on the second, so one extra turn saves an engine round trip.
            if (stage === DIG_STAGE.THIRD_EXAM && Inventory.countById(DIG_ID.OPAL) > 0) {
                if (await talkToNpcId(DIG_NPC.STUDENT_PURPLE, DIG_TILE.STUDENTS, [], log)) {
                    spoke++;
                }
                await Modals.closeIfOpen();
            }
            if (spoke === 0) {
                log('none of the three students would talk');
            }
            return spoke > 0;
        }
    };
}

/** Whether the journal says all three errands are answered and the exam can be taken. */
export function examReady(snap: QuestSnapshot): boolean {
    return snap.progress?.flags.has('exam-ready') ?? false;
}

export function answered(snap: QuestSnapshot, flag: string): boolean {
    return snap.progress?.flags.has(flag) ?? false;
}
