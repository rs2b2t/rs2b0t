import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

// Why: these are the `%upass` values themselves, so `--stage N` in the harness and the number the module
// decides on are the same scale. "Started" is not a stage — it is bit 11 of `%ibanmulti`, carried as a flag.
export const UP_STAGE = {
    NOT_STARTED: 0,
    SPOKEN_KOFTIK: 1,
    PASSED_BRIDGE: 2,
    ENTERED_SECOND_AREA: 3,
    KILLED_UNICORN: 4,
    ENTERED_MAIN_AREA: 5,
    SPOKEN_NILHOOF: 6,
    FOUND_DOLL: 7,
    CONFRONTED_IBAN: 8,
    DEFEATED_IBAN: 9,
    COMPLETE: 10
} as const;

/** Journal-visible sub-progress the stage number cannot carry. */
export const UP_FLAG = {
    /** King Lathas has sent the player to Koftik — bit 11, not a stage. */
    STARTED: 'started',
    /** Koftik has handed over the damp cloth, or an arrow is already part-made. */
    ARROW_PARTS: 'arrowParts',
    RANDAS_DIARY: 'randasDiary',
    WELL_INSCRIPTION: 'wellInscription',
    KOFTIK_INSANE: 'koftikInsane',
    ASHES_ON_DOLL: 'ashesOnDoll',
    BLOOD_ON_DOLL: 'bloodOnDoll',
    SHADOW_ON_DOLL: 'shadowOnDoll',
    DOVE_ON_DOLL: 'doveOnDoll',
    DOLL_COMPLETE: 'dollComplete'
} as const;

export const UPASS = 'Underground Pass';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the journal is strictly additive — every stage keeps the earlier lines and appends its own — so the
// deepest matching line wins and the list is ordered from the end of the quest backwards.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', UP_STAGE.COMPLETE],
    ['throwing iban', UP_STAGE.DEFEATED_IBAN],
    ['after distracting the witch', UP_STAGE.FOUND_DOLL],
    ['the group leader said', UP_STAGE.SPOKEN_NILHOOF],
    ['pass through the double doors', UP_STAGE.ENTERED_MAIN_AREA],
    ["i must 'feed' it", UP_STAGE.KILLED_UNICORN],
    ['something is watching me', UP_STAGE.ENTERED_SECOND_AREA],
    ['after destroying four orbs', UP_STAGE.PASSED_BRIDGE],
    ['i managed to cross the bridge', UP_STAGE.PASSED_BRIDGE],
    ['i have met koftik at an underground river', UP_STAGE.SPOKEN_KOFTIK],
    ['i have met koftik', UP_STAGE.SPOKEN_KOFTIK],
    ['asked me to meet a tracker named koftik', UP_STAGE.NOT_STARTED],
    ['i can start this quest', UP_STAGE.NOT_STARTED]
];

const FLAG_LINES: readonly [string, string][] = [
    ['asked me to meet a tracker named koftik', UP_FLAG.STARTED],
    ['charred remains of some arrows', UP_FLAG.ARROW_PARTS],
    ['it tells of a well that i must enter', UP_FLAG.RANDAS_DIARY],
    ["an inscription says that i must 'feed'", UP_FLAG.WELL_INSCRIPTION],
    ['i fear for his sanity', UP_FLAG.KOFTIK_INSANE],
    ['i rubbed some of the ash into the doll', UP_FLAG.ASHES_ON_DOLL],
    ['smear some of its fluids onto the doll', UP_FLAG.BLOOD_ON_DOLL],
    ["the doll now has iban's shadow", UP_FLAG.SHADOW_ON_DOLL],
    ["imbued it with iban's conscience", UP_FLAG.DOVE_ON_DOLL],
    ['i have completed the doll', UP_FLAG.DOLL_COMPLETE]
];

/**
 * Stage plus sub-progress from the journal text.
 * Why: `%upass` and `%ibanmulti` are both `scope=perm` with no `transmit`, so the journal scroll is the only client-visible record of either.
 */
export function parseUpassJournal(lines: readonly string[] | string): QuestProgress | undefined {
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
    // Why: the journal only prints "confronted" progress as the doll lines, so a complete doll at
    // FOUND_DOLL and CONFRONTED_IBAN read identically — the module resolves the rest from the pack.
    return { stage: hit[1], flags };
}

export async function readUpassProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(UPASS);
    if (status === 'complete') {
        return { stage: UP_STAGE.COMPLETE, flags: new Set() };
    }
    if (status !== 'inProgress' && status !== 'notStarted') {
        return undefined;
    }
    const progress = parseUpassJournal(await Quests.journal(UPASS));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress ?? (status === 'notStarted' ? { stage: UP_STAGE.NOT_STARTED, flags: new Set() } : undefined);
}
