import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { FC_NAME } from './areas.js';

/** `%fishingcompo`. Every rung is rendered by its own journal page. */
export const FC_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    /** Entered, fishing the willow-tree spot — sardines, which lose. */
    IN_COMP: 2,
    /** The garlic has driven the stranger off the pipes; that spot is the bot's. */
    GARLIC_COMP: 3,
    /** Three giant carp handed over; the trophy is the reward. */
    WON_COMP: 4,
    COMPLETE: 5
} as const;

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the page is rebuilt from scratch at each stage rather than struck through, but its first two lines are shared from `started` on, so these needles are the lines that differ.
const STAGES: readonly [string, number][] = [
    ['quest complete!', FC_STAGE.COMPLETE],
    ['i easily won the contest', FC_STAGE.WON_COMP],
    ['next to the pipes', FC_STAGE.GARLIC_COMP],
    ['next to the willow tree', FC_STAGE.IN_COMP],
    ['fishing contest pass', FC_STAGE.STARTED],
    ['i can start this quest by speaking to', FC_STAGE.NOT_STARTED]
];

export function parseFishingContestJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    return STAGES.find(([needle]) => text.includes(needle))?.[1];
}

// Why: no last-good cache here — losing the contest walks the stage back to `started`, so a stale read would send the bot to fish a spot it no longer owns.

export async function readFishingContestStage(): Promise<number | undefined> {
    const status = Quests.status(FC_NAME);
    if (status === 'complete') {
        return FC_STAGE.COMPLETE;
    }
    if (status === 'notStarted') {
        return FC_STAGE.NOT_STARTED;
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const stage = parseFishingContestJournal(await Quests.journal(FC_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}
