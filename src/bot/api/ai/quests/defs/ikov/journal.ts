// docs/QUESTS.md
import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { IKOV_QUEST } from './areas.js';

/** `%ikov`. 20 and 30 render the same page, so the module folds them into `PULLED_LEVER`. */
export const IKOV_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    PULLED_LEVER: 30,
    KILLED_WARRIOR: 40,
    SPOKEN_WINELDA: 50,
    PAID_WINELDA: 60,
    HELPING_ARMADYL: 70,
    COMPLETE: 100
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
    ['quest complete!', IKOV_STAGE.COMPLETE],
    ['guardians of armadyl', IKOV_STAGE.HELPING_ARMADYL],
    ['winelda teleported me across', IKOV_STAGE.PAID_WINELDA],
    ['will teleport me across', IKOV_STAGE.SPOKEN_WINELDA],
    ['i killed it using arrows made of ice', IKOV_STAGE.KILLED_WARRIOR],
    ['i found a trap on a', IKOV_STAGE.PULLED_LEVER],
    ['he has given me a pendant so i can enter the', IKOV_STAGE.STARTED],
    ['i can start this quest at the', IKOV_STAGE.NOT_STARTED]
];

export function parseIkovJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    return STAGES.find(([needle]) => text.includes(needle))?.[1];
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: number | undefined;

export async function readIkovStage(): Promise<number | undefined> {
    const status = Quests.status(IKOV_QUEST);
    if (status === 'complete') {
        return IKOV_STAGE.COMPLETE;
    }
    if (status === 'notStarted') {
        return IKOV_STAGE.NOT_STARTED;
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const stage = parseIkovJournal(await Quests.journal(IKOV_QUEST));
    // Why: the journal body is a main modal, and leaving it up makes every later read come back empty.
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (stage !== undefined) {
        lastGood = stage;
    }
    return stage ?? lastGood;
}
