import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

// Why: stages 6 and 7 render identical journal text and the same step drives both — at 6 the first Inspect flips to 7, at 7 Inspect opens the repair menu.

/** Matches content `quest_mcannon.constant`. */
export const MC_STAGE = {
    NOT_STARTED: 0,
    RAILINGS: 1,
    GUARD_TOWER: 2,
    GOBLIN_CAVE: 3,
    FIND_CHILD: 4,
    CHILD_RESCUED: 5,
    FIX_CANNON: 6,
    CANNON_FIXED: 8,
    SEE_NULODION: 9,
    RETURN_NOTES: 10,
    COMPLETE: 11
} as const;

export const MCANNON_QUEST = 'Dwarf Cannon';

export const MC_FLAG = {
    RAILINGS_DONE: 'railings-done',
    HAS_REMAINS: 'has-remains'
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function readFlags(text: string): Set<string> {
    const flags = new Set<string>();
    if (text.includes('repaired all the broken railings')) {
        flags.add(MC_FLAG.RAILINGS_DONE);
    }
    if (text.includes('found some dwarf remains')) {
        flags.add(MC_FLAG.HAS_REMAINS);
    }
    return flags;
}

function readStage(text: string): number | undefined {
    // Newest progress first — later journal text retains earlier history, and the
    // guard-tower page carries the railings line the stage before it also prints.
    if (text.includes('quest complete!')) {
        return MC_STAGE.COMPLETE;
    }
    if (text.includes('gave me an ammo mould and notes')) {
        return MC_STAGE.RETURN_NOTES;
    }
    if (text.includes('asked me to find nulodion')) {
        return MC_STAGE.SEE_NULODION;
    }
    if (text.includes('fixed the broken multicannon')) {
        return MC_STAGE.CANNON_FIXED;
    }
    if (text.includes('asked me to fix the multicannon')) {
        return MC_STAGE.FIX_CANNON;
    }
    if (text.includes('rescued the dwarf child')) {
        return MC_STAGE.CHILD_RESCUED;
    }
    if (text.includes('next i need to find the')) {
        return MC_STAGE.FIND_CHILD;
    }
    if (text.includes('sent me to find the goblin base')) {
        return MC_STAGE.GOBLIN_CAVE;
    }
    if (text.includes('check up on his guards') || text.includes('i went to the watchtower')) {
        return MC_STAGE.GUARD_TOWER;
    }
    if (text.includes('my first task is to') || text.includes('repaired all the broken railings')) {
        return MC_STAGE.RAILINGS;
    }
    if (text.includes('i can start this quest')) {
        return MC_STAGE.NOT_STARTED;
    }
    return undefined;
}

/**
 * Map quest-list journal text to varp-aligned stages plus sub-progress flags.
 * @see Server content mcannon_journal.rs2
 */
export function parseDwarfCannonJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    return stage === undefined ? undefined : { stage, flags: readFlags(text) };
}

export async function readDwarfCannonProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(MCANNON_QUEST);
    if (status === 'complete') {
        return { stage: MC_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: MC_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }

    const progress = parseDwarfCannonJournal(await Quests.journal(MCANNON_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
