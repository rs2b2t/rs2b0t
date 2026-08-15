import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { EC_QUEST, EC_STAGE } from './areas.js';

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * haunted_journal.rs2 writes one self-contained block per stage rather than
 * appending, but newest-first still holds and matches every other module.
 */
function readStage(text: string): number | undefined {
    if (text.includes('we turned ernest back to normal')) return EC_STAGE.COMPLETE;
    if (text.includes('discovered ernest is a')) return EC_STAGE.SPOKEN_ODDENSTEIN;
    if (text.includes('he went into')) return EC_STAGE.STARTED;
    if (text.includes('i can start this quest by speaking to')) return EC_STAGE.NOT_STARTED;
    return undefined;
}

export function parseErnestJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const stage = readStage(normalize(lines));
    return stage === undefined ? undefined : { stage, flags: new Set() };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readErnestProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(EC_QUEST);
    if (status === 'complete') return { stage: EC_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: EC_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal(EC_QUEST);
    const progress = parseErnestJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
