import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const QUEST = 'Sea Slug Quest';

export const SS_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_HOLGART: 2,
    BOAT_REPAIRED: 3,
    SPOKEN_KENNITH: 4,
    SAILED_KENT: 5,
    SPOKEN_KENT: 6,
    LIT_TORCH: 7,
    KENNITH_NEED_ESCAPE: 8,
    PANEL_OPENED: 9,
    NEED_KENNITH_PATH: 10,
    SAVED_KENNITH: 11,
    COMPLETE: 12
} as const;

const AMBIGUOUS: Record<number, string> = {
    [SS_STAGE.SPOKEN_KENNITH]: 'kennith-or-kent',
    [SS_STAGE.KENNITH_NEED_ESCAPE]: 'panel-or-call'
};

/** Highest first: every page repeats the lines of the ones before it. */
const MARKERS: { text: string; stage: number }[] = [
    { text: 'quest complete!', stage: SS_STAGE.COMPLETE },
    { text: "i've used the crane to lower kennith into the boat", stage: SS_STAGE.SAVED_KENNITH },
    { text: "kennith can't get downstairs without some help", stage: SS_STAGE.NEED_KENNITH_PATH },
    { text: "i've created an opening to let kenneth escape", stage: SS_STAGE.KENNITH_NEED_ESCAPE },
    { text: "kennith won't go near the sea slugs", stage: SS_STAGE.LIT_TORCH },
    { text: "i've found kent on a small island", stage: SS_STAGE.SPOKEN_KENT },
    { text: "i've found kennith", stage: SS_STAGE.SPOKEN_KENNITH },
    { text: 'i gave holgart the swamp paste', stage: SS_STAGE.BOAT_REPAIRED },
    { text: 'his boat is broken', stage: SS_STAGE.SPOKEN_HOLGART },
    { text: 'i need to take the swamp paste to holgart', stage: SS_STAGE.SPOKEN_HOLGART },
    { text: 'i need to talk to holgart', stage: SS_STAGE.STARTED },
    { text: 'i can start this quest by speaking to caroline', stage: SS_STAGE.NOT_STARTED }
];

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function progressFor(stage: number): QuestProgress {
    const flag = AMBIGUOUS[stage];
    return { stage, flags: new Set(flag === undefined ? [] : [flag]) };
}

export function parseSeaSlugJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = MARKERS.find(m => text.includes(m.text));
    return hit ? progressFor(hit.stage) : undefined;
}

export async function readSeaSlugProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return progressFor(SS_STAGE.COMPLETE);
    }
    if (status === 'notStarted') {
        return progressFor(SS_STAGE.NOT_STARTED);
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseSeaSlugJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
