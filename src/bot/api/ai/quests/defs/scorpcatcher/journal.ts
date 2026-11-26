import { questProgressAt, readQuestJournal } from '../../journalReader.js';
import { normalizeJournal as normalize } from '../../journalText.js';
// docs/QUESTS.md
import type { QuestProgress } from '../../engine/types.js';
import { SC_STAGE } from './areas.js';

export const QUEST = 'Scorpion Catcher';

// Why: the journal only counts cages in the pack, so which scorpions are caught is read from the cage obj id, which works for a banked cage too.

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
    // Why: Hint blocks accumulate, so test stage markers newest-first.
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

export function readScorpionProgress(): Promise<QuestProgress | undefined> {
    return readQuestJournal(QUEST, SC_STAGE, parseScorpionJournal, questProgressAt);
}
