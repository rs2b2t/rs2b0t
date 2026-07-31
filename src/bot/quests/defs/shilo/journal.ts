import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Quests } from '../../../api/hud/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const SHILO_QUEST = 'Shilo Village';

/**
 * The engine's stage numbers. Several render identically in the journal and are
 * therefore never distinguished: 1-2 (found the mound), 7-9 before the Bervirius
 * dolmen is searched, 10-11, and 12-14. `decide()` separates those by area and by
 * what is carried, which is what actually drives the next step.
 */
export const SV_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SEARCHED_MOUND: 3,
    DUG_MOUND: 4,
    LIT_MOUND: 5,
    ROPED_MOUND: 6,
    ENTERED_AH_ZA_RHOON: 7,
    UNLOCKED_RASH_TOMB: 10,
    UNLOCKED_TOMBDOOR: 12,
    COMPLETE: 15
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Needles avoid anything a colour tag sits next to: stripping "@dre@" leaves a
// space, so "'@dre@Ah Za Rhoon@dbl@'" normalises to "' ah za rhoon '".
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', SV_STAGE.COMPLETE],
    ["i've placed three bones", SV_STAGE.UNLOCKED_TOMBDOOR],
    ['i made a bone key from the bone shard', SV_STAGE.UNLOCKED_RASH_TOMB],
    ['i climbed down the rope', SV_STAGE.ENTERED_AH_ZA_RHOON],
    ['i attached a rope to the start of the fissure', SV_STAGE.ROPED_MOUND],
    ['i illuminated the fissure', SV_STAGE.LIT_MOUND],
    ['used a spade to excavate', SV_STAGE.DUG_MOUND],
    ["i've found a mound of earth", SV_STAGE.SEARCHED_MOUND],
    ['i need to find the location of', SV_STAGE.STARTED],
    ['i can start this quest', SV_STAGE.NOT_STARTED]
];

const FLAG_LINES: readonly [string, string][] = [
    ["i've read the tattered scroll", 'read-tattered'],
    ['i read the crumpled scroll', 'read-crumpled'],
    ['the lock is made out of bone', 'found-door'],
    ['i searched the dolmen in bervirius tomb', 'pommel-taken']
];

function readFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const [needle, flag] of FLAG_LINES) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    if (text.includes("i've placed three bones")) {
        flags.add('bones-placed:3');
    } else if (text.includes("i've placed two bones")) {
        flags.add('bones-placed:2');
    } else if (text.includes("i've placed one bone")) {
        flags.add('bones-placed:1');
    } else {
        flags.add('bones-placed:0');
    }
    // The three kill paragraphs are cumulative rewrites, not additions.
    if (text.includes('third and final guardian')) {
        flags.add('naza:3');
    } else if (text.includes('a skeletal nazastarool appeared')) {
        flags.add('naza:2');
    } else if (text.includes('a zombie nazastarool attacked me')) {
        flags.add('naza:1');
    } else {
        flags.add('naza:0');
    }
    return flags;
}

export function parseShiloJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    // Newest first: every later entry keeps the whole earlier history.
    const hit = STAGE_LINES.find(([needle]) => text.includes(needle));
    return hit ? { stage: hit[1], flags: readFlags(text) } : undefined;
}

export async function readShiloProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(SHILO_QUEST);
    if (status === 'complete') return { stage: SV_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: SV_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseShiloJournal(await Quests.journal(SHILO_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
