import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { MURDER_NAME } from './areas.js';

export const MURDER_STAGE = { NOT_STARTED: 0, STARTED: 1, COMPLETE: 2 } as const;

/** The three evidence lines the page adds one at a time. */
export const POISON_PROVED = 'poison-proved';
export const THREAD_FOUND = 'thread';
export const WEAPON_TAKEN = 'weapon';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const STAGES: readonly [string, number][] = [
    ['quest complete!', MURDER_STAGE.COMPLETE],
    ['lord sinclair, a prominent nobleman', MURDER_STAGE.STARTED],
    ['i can start this quest by speaking to', MURDER_STAGE.NOT_STARTED]
];

const FLAGS: readonly [string, string][] = [
    ['indisputable evidence', POISON_PROVED],
    ['i have found some coloured thread', THREAD_FOUND],
    ['i have taken the murder weapon', WEAPON_TAKEN]
];

export function parseMurderJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
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
    return { stage: hit[1], flags };
}

// Why: the page drops every in-progress line once the poison is proved, so a stale read is not evidence the quest went backwards.
let lastGood: QuestProgress | undefined;

export async function readMurderProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(MURDER_NAME);
    if (status === 'complete') {
        return { stage: MURDER_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: MURDER_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseMurderJournal(await Quests.journal(MURDER_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}

/** Test seam: the last good read is memoised for the process. */
export function resetMurderProgressCache(): void {
    lastGood = undefined;
}
