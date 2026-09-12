import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { WITCHS_HOUSE_QUEST } from './areas.js';

/** Matches content `quest_ball.constant`; 4 is unused there. */
export const WH_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    FOUND_MAGNET: 2,
    UNLOCKED_DOOR: 3,
    READ_DIARY: 5,
    DEFEATED: 6,
    COMPLETE: 7
} as const;

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return ' ' + (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the page keeps every earlier line struck through, so the magnet line is still on the back-door page and only this order separates them.
// Why: stages 3 and 5 render from one branch of `ball_journal.rs2`, so the diary read is invisible here and `DiaryState` carries it instead.
const STAGES: readonly [string, number][] = [
    [' quest complete!', WH_STAGE.COMPLETE],
    [' now the shapeshifter is dead', WH_STAGE.DEFEATED],
    [' i have worked out how to unlock the back door', WH_STAGE.UNLOCKED_DOOR],
    [' i have found a magnet in a cupboard', WH_STAGE.FOUND_MAGNET],
    [' i should find a way into the garden', WH_STAGE.STARTED],
    [' i can start this quest', WH_STAGE.NOT_STARTED]
];

/**
 * Journal text to a varp-aligned stage.
 * @see Server content ball_journal.rs2
 */
export function parseWitchsHouseJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = STAGES.find(([needle]) => text.includes(needle));
    return hit ? { stage: hit[1], flags: new Set<string>() } : undefined;
}

// Why: `witch.rs2` can reset the varp from 3 to 1, so do not retain a later cached stage.

export async function readWitchsHouseProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(WITCHS_HOUSE_QUEST);
    if (status === 'complete') {
        return { stage: WH_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: WH_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }

    const progress = parseWitchsHouseJournal(await Quests.journal(WITCHS_HOUSE_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
