// docs/QUESTS.md
import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { SC_STAGE } from './areas.js';

export const QUEST = 'Scorpion Catcher';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: which scorpions are caught is not read here — the journal counts only the cages in the pack, while the cage obj id says it for a banked cage too.

/**
 * `%scorpcatcher` from the journal page.
 * @see docs/reference/quest-engine.md#quest-state
 */
export function parseScorpionJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const at = (stage: number): QuestProgress => ({ stage, flags: new Set() });
    if (text.includes('quest complete!')) {
        return at(SC_STAGE.COMPLETE);
    }
    // Why: the hint blocks accumulate, so the latest one has to be tested first or every later stage reads as the first hint.
    if (text.includes('the second kharid scorpion')) {
        return at(SC_STAGE.SECOND_HINT);
    }
    if (text.includes('the first kharid scorpion')) {
        return at(SC_STAGE.FIRST_HINT);
    }
    if (text.includes("i've spoken to thormac in the sorcerer's tower")) {
        return at(SC_STAGE.STARTED);
    }
    if (text.includes('i can start this quest by speaking to') && text.includes('thormac')) {
        return at(SC_STAGE.NOT_STARTED);
    }
    return undefined;
}

export async function readScorpionProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: SC_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: SC_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseScorpionJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
