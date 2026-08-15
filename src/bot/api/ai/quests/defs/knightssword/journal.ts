import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { KS_QUEST, KS_STAGE } from './areas.js';

/**
 * `@dbl@`-style colour tags become a space, so a needle must never span a tag
 * boundary that sits next to punctuation.
 * @see docs/reference/quest-engine.md#quest-state
 */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Newest marker first: squire_journal.rs2 appends, so every earlier stage's
 * prose is still on the scroll at the later ones.
 */
function readStage(text: string): number | undefined {
    if (text.includes('quest complete!')) return KS_STAGE.COMPLETE;
    if (text.includes('thurgo has now smithed me a replica')) return KS_STAGE.LOOKING_BLURITE;
    if (text.includes('according to thurgo to make a replica sword')) return KS_STAGE.LOOKING_BLURITE;
    if (text.includes('the squire told me about a')) return KS_STAGE.LOOKING_PORTRAIT;
    if (text.includes('needs a picture of the sword before he can help')) return KS_STAGE.SPOKEN_THURGO;
    if (text.includes('gained his trust through')) return KS_STAGE.GIVEN_PIE;
    if (text.includes("reldo couldn't give me much information")) return KS_STAGE.SPOKEN_RELDO;
    if (text.includes('the squire suggests i speak to')) return KS_STAGE.STARTED;
    if (text.includes('i can start this quest by talking to the')) return KS_STAGE.NOT_STARTED;
    return undefined;
}

export function parseKnightsSwordJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const stage = readStage(normalize(lines));
    return stage === undefined ? undefined : { stage, flags: new Set() };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readKnightsSwordProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(KS_QUEST);
    if (status === 'complete') return { stage: KS_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: KS_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal(KS_QUEST);
    const progress = parseKnightsSwordJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
