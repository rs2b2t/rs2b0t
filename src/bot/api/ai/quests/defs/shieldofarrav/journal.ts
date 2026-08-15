import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { SOA_NAME } from './areas.js';

/**
 * One ladder folding both gang varps. Values below 20 are `%phoenixgang`,
 * values from 21 up are `%blackarmgang`, and 30 is either one complete.
 */
export const SOA_STAGE = {
    NOT_STARTED: 0,
    TOLD_OF_BOOK: 1,
    READ_BOOK: 2,
    SENT_TO_BARAEK: 3,
    FIND_STRAVEN: 4,
    KILL_JONNY: 8,
    PHOENIX_JOINED: 9,
    TRAMP_TOLD: 21,
    KATRINE_TASK: 22,
    BLACKARM_JOINED: 23,
    COMPLETE: 30
} as const;

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the page keeps every earlier line struck through, so an early needle still matches in a late state and this order is the only thing separating them.
const STAGES: readonly [string, number][] = [
    ['quest complete!', SOA_STAGE.COMPLETE],
    ['allowed me to join the black arm gang', SOA_STAGE.BLACKARM_JOINED],
    ['allowed me to join the phoenix gang', SOA_STAGE.PHOENIX_JOINED],
    ['stealing two phoenix crossbows', SOA_STAGE.KATRINE_TASK],
    ['in return for killing jonny the beard', SOA_STAGE.KILL_JONNY],
    ['he directed me to speak to katrine', SOA_STAGE.TRAMP_TOLD],
    ['about joining', SOA_STAGE.TRAMP_TOLD],
    ['i should find them and join', SOA_STAGE.FIND_STRAVEN],
    ['named baraek', SOA_STAGE.SENT_TO_BARAEK],
    ['if he knows anything more about this', SOA_STAGE.READ_BOOK],
    ['says there is a quest hidden in one of the books', SOA_STAGE.TOLD_OF_BOOK],
    ['i can start this quest by speaking to', SOA_STAGE.NOT_STARTED]
];

// Why: one stage renders several pages depending on what is carried, and the flag is the only thing that tells them apart.
const FLAGS: readonly [string, string][] = [
    ['i should now give one to a fellow adventurer', 'two-certificates'],
    ['collect my reward', 'certificate'],
    ['i should take them both to the curator', 'both-halves'],
    ['can find the other shield half', 'own-half-only'],
    ['i should now return them to katrine', 'crossbows-held'],
    ['i should now be able to steal the crossbows', 'key-held'],
    ['i confronted and killed jonny the beard', 'report-held']
];

export function parseShieldOfArravJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    const hit = STAGES.find(([needle]) => text.includes(needle));
    if (!hit) {
        return undefined;
    }
    const flags = new Set<string>();
    for (const [needle, flag] of FLAGS) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    // Why: the killed-Jonny line stays on the page struck through after the hand-in, so it is evidence only while the mission is still the stage.
    if (hit[1] !== SOA_STAGE.KILL_JONNY) {
        flags.delete('report-held');
    }
    return { stage: hit[1], flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readShieldOfArravProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(SOA_NAME);
    if (status === 'complete') return { stage: SOA_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: SOA_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseShieldOfArravJournal(await Quests.journal(SOA_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
