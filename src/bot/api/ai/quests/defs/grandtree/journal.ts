// docs/reference/quest-engine.md#how-modules-should-read-progress
import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { GT_STAGE } from './areas.js';

export const QUEST = 'The Grand Tree';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: every finished stage stays on the page as a `@str@` line, and several of them are word-for-word the `@dbl@` line of the stage before, so the needles are matched newest-first.
// Why: none of them spans a colour tag, because stripping one leaves a space where it stood.

/** Journal needles, highest stage first — the first hit is the stage. */
const NEEDLES: readonly [number, string][] = [
    [GT_STAGE.COMPLETE, 'quest complete!'],
    [GT_STAGE.SEARCHING_DACONIA, 'king narnode has seen the light'],
    [GT_STAGE.DEFEATED_BLACK_DEMON, 'he should be in these caves somewhere'],
    [GT_STAGE.UNLOCKED_TRAPDOOR, "i should investigate what's behind the"],
    [GT_STAGE.GIVEN_TWIGS, "isn't convinced but gave me some"],
    [GT_STAGE.FOUND_INVASION_PLANS, 'i should talk to the king and see what he says'],
    [GT_STAGE.CLUE_CHARLIE, 'has suggested i ask'],
    [GT_STAGE.OBTAINED_LUMBER_ORDER, 'i have an invoice that the foreman had'],
    [GT_STAGE.RELEASED_PRISON, 'has told me to use the'],
    [GT_STAGE.FOUND_JOURNAL, 'i should go speak to him again'],
    [GT_STAGE.SPOKEN_PRISONER, "and agreed to search glough's house"],
    [GT_STAGE.FOUND_PRISONER, 'said i can speak to'],
    [GT_STAGE.SPOKEN_GLOUGH, 'maybe i should have a chat with'],
    [GT_STAGE.RELAYED_MESSAGE, 'the king wants me to tell'],
    [GT_STAGE.SPOKEN_HAZELMERE, 'i then need to give the message'],
    [GT_STAGE.STARTED, 'he has asked me to take a'],
    [GT_STAGE.NOT_STARTED, 'i can start this quest at the']
];

export function parseGrandTreeJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    for (const [stage, needle] of NEEDLES) {
        if (text.includes(needle)) {
            return stage;
        }
    }
    return undefined;
}

// Why: reading the journal opens a main modal, and the demon fight is the one place where standing still to do that is punished — so the last reading is kept and only ever moves forward.
let lastStage: number | undefined;

/** Test hook: the cached floor survives between quests inside one bundle. */
export function resetGrandTreeStage(): void {
    lastStage = undefined;
}

export async function readGrandTreeStage(): Promise<number | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        lastStage = GT_STAGE.COMPLETE;
        return lastStage;
    }
    if (status === 'notStarted') {
        lastStage = GT_STAGE.NOT_STARTED;
        return lastStage;
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const parsed = parseGrandTreeJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (parsed !== undefined && (lastStage === undefined || parsed > lastStage)) {
        lastStage = parsed;
    }
    return parsed ?? lastStage;
}
