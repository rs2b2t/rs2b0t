import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { SM_QUEST, SM_STAGE, SM_VARP } from './areas.js';

/** Counted journal flags this module branches on, all read off transmitted varps. */
export const SM_FLAG = {
    /** Temple rebuild, 0–100; the fire altar appears at 100. */
    REPAIRED: 'repaired',
    /** Material resource pool, 0–100. */
    RESOURCES: 'resources',
    /** Sanctity, 0–100; 10 lights the altar and sanctifies oil, 20 makes the serum permanent. */
    SANCTITY: 'sanctity'
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: mortton_journal.rs2 appends, so every earlier stage's prose is still on the page — newest marker first, or an early line answers for a late stage.
const MARKERS: readonly [string, number][] = [
    ['quest complete!', SM_STAGE.COMPLETE],
    ['the shades spirit was released', SM_STAGE.LIT_PYRE],
    ['i placed some pyre logs onto a funeral pyre', SM_STAGE.LOGS_ON_PYRE],
    ['i used sacred oil on logs turning them into pyre logs', SM_STAGE.CREATED_PYRE_LOGS],
    ['i placed a flask of olive oil in the flame', SM_STAGE.CREATED_SACRED_OIL],
    ['i helped rebuild the temple using limestone bricks', SM_STAGE.CAN_LIGHT_ALTAR],
    ["i've started rebuilding the temple", SM_STAGE.REBUILD_TEMPLE],
    ["he's quite interested in 'flaemtaer temple'", SM_STAGE.ULSQUIRE_TEMPLE],
    ['maybe if i investigate around here a little more', SM_STAGE.SHADES_TO_ULSQUIRE],
    ['i should show the shade remains to', SM_STAGE.SHADES_TO_RAZMIRE],
    ["i've killed all five shades", SM_STAGE.KILLED_5],
    ["i've killed four shades", SM_STAGE.KILLED_4],
    ["i've killed three shades", SM_STAGE.KILLED_3],
    ["i've killed two shades", SM_STAGE.KILLED_2],
    ["i've killed one shade", SM_STAGE.KILLED_1],
    ['i have to kill five shades', SM_STAGE.KILL_SHADES],
    ['i used the serum on a local npc', SM_STAGE.MADE_SERUM],
    ['i made serum 207 from tarromin', SM_STAGE.MADE_SERUM],
    // Why: from stage 10 on the page says "and found the town", so the pronoun is what separates the two.
    ['and i found the town of', SM_STAGE.READ_DIARY],
    ['i can start this quest by exploring the town of', SM_STAGE.NOT_STARTED]
];

export function parseMorttonJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    return MARKERS.find(([needle]) => text.includes(needle))?.[1];
}

// Why: `%morttonquest` is server-only, but the three flamtaer meters carry `transmit=yes`, so the temple leg reads them without opening anything.
// Why: Razmire's ai_timer only recomputes them while the player stands in the temple zone, so they are last-known values elsewhere.

/** The three transmitted flamtaer meters, as counted flags. */
export function templeFlags(): Set<string> {
    return new Set([
        `${SM_FLAG.REPAIRED}:${reader.varp(SM_VARP.TEMPLE_REPAIRED)}`,
        `${SM_FLAG.RESOURCES}:${reader.varp(SM_VARP.TEMPLE_RESOURCES)}`,
        `${SM_FLAG.SANCTITY}:${reader.varp(SM_VARP.TEMPLE_SANCTITY)}`
    ]);
}

/** A failed read is not evidence the quest went backwards. */
let lastStage: number | undefined;

export async function readMorttonProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(SM_QUEST);
    if (status === 'complete') {
        return { stage: SM_STAGE.COMPLETE, flags: templeFlags() };
    }
    if (status === 'notStarted') {
        return { stage: SM_STAGE.NOT_STARTED, flags: templeFlags() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const stage = parseMorttonJournal(await Quests.journal(SM_QUEST));
    // Why: a mesbox left on main blanks every journal read behind it, and the temple refuses in mesboxes.
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (stage !== undefined) {
        lastStage = stage;
    }
    const settled = stage ?? lastStage;
    return settled === undefined ? undefined : { stage: settled, flags: templeFlags() };
}
