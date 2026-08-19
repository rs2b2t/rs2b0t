import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

// Why: these are the `%regicide_quest` values themselves, so `--stage N` in the harness and the number the module decides on are the same scale.
export const RG_STAGE = {
    NOT_STARTED: 0,
    RECEIVED_MESSAGE: 1,
    SPOKEN_LATHAS: 2,
    SPOKEN_SCOUTS: 3,
    SPOKEN_IORWERTH: 4,
    SPOKEN_TRACKER: 5,
    SHOWN_PENDANT: 6,
    FOUND_FOOTPRINTS: 7,
    SPOKEN_TRACKER2: 8,
    DEFEATED_GUARD: 9,
    ENTERED_CAMP: 10,
    SPOKEN_IORWERTH2: 11,
    KILLED_TYRAS: 12,
    REPORTED_IORWERTH: 13,
    SPOKEN_ARIANWYN: 14,
    COMPLETE: 15
} as const;

/** Journal-visible sub-progress the stage number cannot carry. */
export const RG_FLAG = {
    /** Lord Iorwerth has handed over the crystal pendant. */
    PENDANT: 'pendant',
    /** The chemist has read the Big Book o' Bangs, so the still is available. */
    CHEMIST: 'chemist'
} as const;

export const REGICIDE = 'Regicide';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the journal is strictly additive — every stage keeps the earlier lines and appends its own — so the deepest matching line wins and the list is ordered from the end of the quest backwards.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', RG_STAGE.COMPLETE],
    ['when returning home i met an elf', RG_STAGE.SPOKEN_ARIANWYN],
    ['has given me a message to carry to', RG_STAGE.REPORTED_IORWERTH],
    ['the catapult provided a great way', RG_STAGE.KILLED_TYRAS],
    ['has given me a book', RG_STAGE.SPOKEN_IORWERTH2],
    ['i have found the camp of king tyras', RG_STAGE.ENTERED_CAMP],
    ['pushing my way through the undergrowth', RG_STAGE.DEFEATED_GUARD],
    ['i asked the tracker about the tracks', RG_STAGE.SPOKEN_TRACKER2],
    ['i have found some tracks leading off', RG_STAGE.FOUND_FOOTPRINTS],
    ['after proving that i was not a bandit', RG_STAGE.SHOWN_PENDANT],
    ['has given me his pendant as proof', RG_STAGE.SPOKEN_TRACKER],
    ["the tracker didn't trust me", RG_STAGE.SPOKEN_TRACKER],
    ['has offered the help of one of his', RG_STAGE.SPOKEN_IORWERTH],
    ['i have met a elvish scout party', RG_STAGE.SPOKEN_SCOUTS],
    ['asked me to re-enter the underground', RG_STAGE.SPOKEN_LATHAS],
    ['a courier has given me a message', RG_STAGE.RECEIVED_MESSAGE],
    ['will send word when i can start', RG_STAGE.NOT_STARTED],
    // Why: Underground Pass opens its own scroll with "I can start this quest by speaking to King Lathas" as well, and only the castle names this one — a looser needle reads any quest's scroll as Regicide's.
    ['king lathas in ardougne castle', RG_STAGE.NOT_STARTED]
];

const FLAG_LINES: readonly [string, string][] = [
    ['has given me his pendant as proof', RG_FLAG.PENDANT],
    ['the chemist read the book', RG_FLAG.CHEMIST]
];

/**
 * Stage plus sub-progress from the journal text.
 * Why: `%regicide_quest` and `%regicide_bits` are both `scope=perm` with no `transmit`, so the journal scroll is the only client-visible record of either.
 */
export function parseRegicideJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = STAGE_LINES.find(([needle]) => text.includes(needle));
    if (hit === undefined) {
        return undefined;
    }
    const flags = new Set<string>();
    for (const [needle, flag] of FLAG_LINES) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    return { stage: hit[1], flags };
}

export async function readRegicideProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(REGICIDE);
    if (status === 'complete') {
        return { stage: RG_STAGE.COMPLETE, flags: new Set() };
    }
    if (status !== 'inProgress' && status !== 'notStarted') {
        return undefined;
    }
    const progress = parseRegicideJournal(await Quests.journal(REGICIDE));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress ?? (status === 'notStarted' ? { stage: RG_STAGE.NOT_STARTED, flags: new Set() } : undefined);
}
