import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

/** `quest_tree.constant`, plus `^tree_complete` from `general/configs/quest.constant`. */
export const TG_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_MONTAI: 2,
    GAVE_LOGS: 3,
    FINDING_TRACKERS: 4,
    BALLISTA_FIRED: 5,
    RETRIEVED_ORB: 6,
    RETURNED_FIRST_ORB: 7,
    DEFEATED_WARLORD: 8,
    COMPLETE: 9
} as const;

const TREE_GNOME_VILLAGE = 'Tree Gnome Village';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: every stage keeps the past-tense lines of the ones before it, so the highest match names the stage and no needle may span a colour tag.
const STAGE_LINES: readonly [string, number][] = [
    ['quest complete!', TG_STAGE.COMPLETE],
    ['after a fierce battle i defeated the warlord', TG_STAGE.DEFEATED_WARLORD],
    ['i returned the orb to king bolren', TG_STAGE.RETURNED_FIRST_ORB],
    ['with the stronghold breached', TG_STAGE.RETRIEVED_ORB],
    ['i found the three trackers', TG_STAGE.BALLISTA_FIRED],
    ['now their defences were secure', TG_STAGE.FINDING_TRACKERS],
    ['i brought montai logs', TG_STAGE.GAVE_LOGS],
    ['i spoke to montai', TG_STAGE.SPOKEN_MONTAI],
    ['i spoke to king bolren who told me', TG_STAGE.STARTED],
    ['i can start this quest by speaking to', TG_STAGE.NOT_STARTED]
];

export function parseTreeGnomeJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = STAGE_LINES.find(([needle]) => text.includes(needle));
    return hit === undefined ? undefined : { stage: hit[1], flags: new Set() };
}

export async function readTreeGnomeProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(TREE_GNOME_VILLAGE);
    if (status === 'complete') {
        return { stage: TG_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: TG_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseTreeGnomeJournal(await Quests.journal(TREE_GNOME_VILLAGE));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
