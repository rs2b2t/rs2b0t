import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const PC_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    GASMASK: 2,
    MUD_START: 3,
    MUD_SOFT: 7,
    TUNNEL: 8,
    ROPE_TIED: 9,
    PIPE_OPEN: 10,
    SHOWN_PICTURE: 20,
    RETURNED_BOOK: 21,
    SPOKEN_PARENTS: 22,
    SPOKEN_MILLI: 23,
    NEED_CLEARANCE: 24,
    SPOKEN_CLERK: 25,
    SPOKEN_BRAVEK: 26,
    CURED_BRAVEK: 27,
    FREED_ELENA: 28,
    COMPLETE: 29,
    READ_SCROLL: 30
} as const;

const PLAGUE_CITY = 'Plague City';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: stages 3 to 6 share one water line and 24/25 share one clearance line, so the parser reports the low end and the module resolves the rest from the pack.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', PC_STAGE.COMPLETE],
    ["i've freed elena from the plague house", PC_STAGE.FREED_ELENA],
    ["i've given bravek the hangover cure", PC_STAGE.CURED_BRAVEK],
    ['bravek might give me clearance if i make his hangover', PC_STAGE.SPOKEN_BRAVEK],
    ['i need clearance from either the', PC_STAGE.NEED_CLEARANCE],
    ["i've spoken to milli about elena", PC_STAGE.SPOKEN_MILLI],
    ['daughter milli may have seen elena', PC_STAGE.SPOKEN_PARENTS],
    ["i've spoken to jethick", PC_STAGE.SHOWN_PICTURE],
    ["i've managed to clear the way into west ardougne", PC_STAGE.PIPE_OPEN],
    ["i've tied a rope to the sewer grill", PC_STAGE.ROPE_TIED],
    ["i've dug a tunnel into the sewers", PC_STAGE.TUNNEL],
    ["i've softened the ground in edmond's garden", PC_STAGE.MUD_SOFT],
    ['i need to use water to soften the ground', PC_STAGE.MUD_START],
    ["i've spoken to edmond about getting into west ardougne", PC_STAGE.MUD_START],
    ['alrena has given me a gasmask', PC_STAGE.GASMASK],
    ['i need to get some dwellberries', PC_STAGE.STARTED],
    ["i've spoken to edmond, he's asked me to help", PC_STAGE.STARTED],
    ['i can start this quest', PC_STAGE.NOT_STARTED]
];

export function parsePlagueJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = STAGE_LINES.find(([needle]) => text.includes(needle));
    return hit === undefined ? undefined : { stage: hit[1], flags: new Set() };
}

export async function readPlagueProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(PLAGUE_CITY);
    if (status === 'complete') {
        return { stage: PC_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: PC_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parsePlagueJournal(await Quests.journal(PLAGUE_CITY));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
