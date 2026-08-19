import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { GRAIL_NAME } from './areas.js';

/** `%grail`, from `quest_grail.constant`. 1, 5 and 6 are unused by the content. */
export const GRAIL_STAGE = {
    NOT_STARTED: 0,
    STARTED: 2,
    SPOKEN_MERLIN: 3,
    SPOKEN_CRONE: 4,
    FAILED_TITAN: 7,
    FINDING_PERCIVAL: 8,
    GIVEN_WHISTLE: 9,
    COMPLETE: 10
} as const;

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: every earlier line stays on the page struck through, so an early needle still matches in a late state and this order is the only thing separating them.
const STAGES: readonly [string, number][] = [
    ['quest complete!', GRAIL_STAGE.COMPLETE],
    ["i honoured the fisher king's request", GRAIL_STAGE.GIVEN_WHISTLE],
    ['the fisher king is very sick', GRAIL_STAGE.FINDING_PERCIVAL],
    ['i need to find a weapon', GRAIL_STAGE.FAILED_TITAN],
    ['i spoke to galahad in his shack', GRAIL_STAGE.SPOKEN_CRONE],
    ['according to a crone on entrana', GRAIL_STAGE.SPOKEN_CRONE],
    ['merlin suggested two things', GRAIL_STAGE.SPOKEN_MERLIN],
    ['i should start my quest by speaking to', GRAIL_STAGE.STARTED],
    ['i can start this quest by speaking to', GRAIL_STAGE.NOT_STARTED]
];

// Why: no flags — beating the titan never moves the varp and never prints a line at the stage it happens on, so the crossing is read from where the player is standing, and everything else the quest branches on is an item.

export function parseHolyGrailJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    const hit = STAGES.find(([needle]) => text.includes(needle));
    return hit ? { stage: hit[1], flags: new Set<string>() } : undefined;
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readHolyGrailProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(GRAIL_NAME);
    if (status === 'complete') { return { stage: GRAIL_STAGE.COMPLETE, flags: new Set() }; }
    if (status === 'notStarted') { return { stage: GRAIL_STAGE.NOT_STARTED, flags: new Set() }; }
    if (status !== 'inProgress') { return undefined; }

    const progress = parseHolyGrailJournal(await Quests.journal(GRAIL_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
