import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

/** `%biohazard`, from quest_biohazard.constant. 8, 9, 11 and 13 are unused. */
export const BIO_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_JERICO: 2,
    USED_BIRDFEED: 3,
    RELEASED_PIGEONS: 4,
    CLIMBED_LADDER: 5,
    POISONED_STEW: 6,
    FOUND_DISTILLATOR: 7,
    GIVEN_DISTILLATOR: 10,
    SPOKEN_CHEMIST: 12,
    FOUND_SECRET: 14,
    REPORTED_ELENA: 15,
    COMPLETE: 16
} as const;

const BIOHAZARD = 'Biohazard';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the journal appends rather than replaces, so every line from an earlier stage is still
// on the page — the most advanced match wins and the order here is the order they are tested.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', BIO_STAGE.COMPLETE],
    ['i need to confront the', BIO_STAGE.REPORTED_ELENA],
    ['findings were very interesting', BIO_STAGE.FOUND_SECRET],
    ["i've given all the items to guidor", BIO_STAGE.FOUND_SECRET],
    ['the varrock guards are out looking for someone', BIO_STAGE.SPOKEN_CHEMIST],
    ['elena gave me some chemicals to take to guidor', BIO_STAGE.SPOKEN_CHEMIST],
    ["elena's asked me to take the following items to", BIO_STAGE.GIVEN_DISTILLATOR],
    ["i've found elena's distillator and returned it to her", BIO_STAGE.GIVEN_DISTILLATOR],
    ["i managed to find elena's distillator", BIO_STAGE.FOUND_DISTILLATOR],
    ["i have rather unkindly poisoned the mourners' stew", BIO_STAGE.POISONED_STEW],
    ["i've crossed the wall into west ardougne", BIO_STAGE.CLIMBED_LADDER],
    ['the watch tower is now surrounded by flapping pigeons', BIO_STAGE.RELEASED_PIGEONS],
    ["i've chucked some birdfeed onto the watch tower", BIO_STAGE.USED_BIRDFEED],
    ['will be able to get me over the wall', BIO_STAGE.SPOKEN_JERICO],
    ["i've spoken to jerico about getting into west ardougne", BIO_STAGE.SPOKEN_JERICO],
    ['about getting over the wall', BIO_STAGE.STARTED],
    ['i can start this quest by speaking to', BIO_STAGE.NOT_STARTED]
];

export function parseBiohazardJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = STAGE_LINES.find(([needle]) => text.includes(needle));
    return hit === undefined ? undefined : { stage: hit[1], flags: new Set() };
}

export async function readBiohazardProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(BIOHAZARD);
    if (status === 'complete') {
        return { stage: BIO_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: BIO_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseBiohazardJournal(await Quests.journal(BIOHAZARD));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
