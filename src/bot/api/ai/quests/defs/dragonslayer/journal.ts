import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

/** Mirrors quest_dragon.constant; the engine skips 4-6. */
export const DRAGON_STAGE = {
    NOT_STARTED: 0,
    SPOKEN_GUILDMASTER: 1,
    SPOKEN_OZIACH: 2,
    BOUGHT_SHIP: 3,
    REPAIRED_SHIP: 7,
    NED_GIVEN_MAP: 8,
    SAILED_TO_CRANDOR: 9,
    COMPLETE: 10
} as const;

const DRAGON_QUEST = 'Dragon Slayer';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const FLAG_LINES: readonly [string, string][] = [
    ['i should return to oziach for more detailed instructions', 'needs-briefing'],
    ["hidden in melzar's maze", 'map-melzar'],
    ['hidden in beneath ice', 'map-ice'],
    ['the goblin, wormbrain, stole', 'map-wormbrain'],
    ['gave me an anti-dragonbreath', 'has-shield'],
    ["the map's behind a door below", 'asked-oracle'],
    ['i have repaired my ship using wooden planks', 'ship-repaired'],
    ['has agreed to sail', 'ned-hired'],
    ['i have found the secret passage', 'secret-passage']
];

function readFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const [needle, flag] of FLAG_LINES) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    return flags;
}

function readStage(text: string): number | undefined {
    // Each entry keeps the earlier history, so match the newest marker first.
    if (text.includes('quest complete!')) return DRAGON_STAGE.COMPLETE;
    if (text.includes('all i need to do is kill the')) return DRAGON_STAGE.SAILED_TO_CRANDOR;
    if (text.includes('set sail for')) return DRAGON_STAGE.NED_GIVEN_MAP;
    if (text.includes('i still need to find a captain')) {
        return text.includes('i have repaired my ship using wooden planks')
            ? DRAGON_STAGE.REPAIRED_SHIP
            : DRAGON_STAGE.BOUGHT_SHIP;
    }
    if (text.includes('i should see if there is a ship for sale')) return DRAGON_STAGE.SPOKEN_OZIACH;
    if (text.includes('i should return to oziach for more detailed instructions')) return DRAGON_STAGE.SPOKEN_OZIACH;
    if (text.includes('i should speak to oziach')) return DRAGON_STAGE.SPOKEN_GUILDMASTER;
    if (text.includes('i can start this quest')) return DRAGON_STAGE.NOT_STARTED;
    return undefined;
}

export function parseDragonJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    return stage === undefined ? undefined : { stage, flags: readFlags(text) };
}

// Why: the journal modal does not always open — a leftover dialogue, a level change, a tick where the tab has not refreshed.
// Why: a failed read is no evidence the quest went backwards, so the last good one stands in until the next success.
let lastGood: QuestProgress | undefined;

// Why: `decide()` branches entirely on this, so a flag that flaps between loops means the read is failing rather than the quest moving backwards.

/** What the last journal read saw. */
export interface JournalRead {
    reads: number;
    failures: number;
    cached: boolean;
    chars: number;
    stage?: number;
    flags: string[];
}

export const journalRead: JournalRead = { reads: 0, failures: 0, cached: false, chars: 0, flags: [] };

export function describeJournal(): string {
    const { stage, flags, cached, failures, reads } = journalRead;
    return `stage=${stage ?? '?'} flags=[${flags.join(',') || 'none'}]`
        + `${cached ? ' (CACHED — this read failed)' : ''}`
        + `${failures > 0 ? ` reads=${reads} failures=${failures}` : ''}`;
}

export async function readDragonProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(DRAGON_QUEST);
    if (status === 'complete') return { stage: DRAGON_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: DRAGON_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal(DRAGON_QUEST);
    const progress = parseDragonJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    journalRead.reads++;
    journalRead.chars = normalize(lines).length;
    journalRead.cached = progress === undefined;
    if (progress) {
        lastGood = progress;
    } else {
        journalRead.failures++;
    }
    const used = progress ?? lastGood;
    journalRead.stage = used?.stage;
    journalRead.flags = [...(used?.flags ?? [])];
    return used;
}
