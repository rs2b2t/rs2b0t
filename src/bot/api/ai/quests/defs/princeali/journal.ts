// docs/reference/quest-engine.md#quest-state
import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

const PRINCE_QUEST = 'Prince Ali Rescue';

export const PRINCE_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    SPOKEN_OSMAN: 20,
    PREP_FINISHED: 30,
    GUARD_DRUNK: 40,
    TIED_KELI: 50,
    SAVED: 100,
    COMPLETE: 110
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Newest first: every entry keeps the earlier history.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', PRINCE_STAGE.COMPLETE],
    ['i then used a wig, a skirt and some skin paste', PRINCE_STAGE.SAVED],
    ['i used my rope to tie up lady', PRINCE_STAGE.TIED_KELI],
    ['i also had to prevent the guard from seeing what i was up', PRINCE_STAGE.GUARD_DRUNK],
    ['i need to deal with the', PRINCE_STAGE.PREP_FINISHED],
    ['for advice', PRINCE_STAGE.SPOKEN_OSMAN],
    ['i should go and speak to', PRINCE_STAGE.STARTED],
    ['i can start this quest by speaking to', PRINCE_STAGE.NOT_STARTED]
];

export function parsePrinceJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    for (const [needle, stage] of STAGE_LINES) {
        if (text.includes(needle)) {
            return { stage, flags: new Set() };
        }
    }
    return undefined;
}

export async function readPrinceProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(PRINCE_QUEST);
    if (status === 'complete') {
        return { stage: PRINCE_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: PRINCE_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    // Why: the journal will not open while another box is up, as Quests.journal waits for modals().main to change and the quest-list button is dropped while a chat dialogue is on screen.
    // Why: this quest ends several steps on a mesbox, so one read can come back empty, which reads as 'stage unavailable'.
    for (let attempt = 0; attempt < 3; attempt++) {
        await closeMainModal();
        const progress = parsePrinceJournal(await Quests.journal(PRINCE_QUEST));
        await closeMainModal();
        if (progress) {
            return progress;
        }
        await Execution.delayTicks(1);
    }
    return undefined;
}

async function closeMainModal(): Promise<void> {
    if (reader.modals().main === -1) {
        return;
    }
    actions.closeModal();
    await Execution.delayUntil(() => reader.modals().main === -1, 2000);
}
