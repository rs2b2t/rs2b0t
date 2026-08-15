import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { NS_QUEST, NS_STAGE } from './areas.js';

/** Journal sub-progress this module branches on. */
export const NS_FLAG = {
    NATURE: 'nature',
    SPIRIT: 'spirit'
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: druidspirit_journal.rs2 appends, so every earlier stage's prose is still on the page — newest marker first, or an early line answers for a late stage.
const MARKERS: readonly [string, number][] = [
    ['quest complete!', NS_STAGE.COMPLETE],
    ["i've killed three ghasts now.", NS_STAGE.KILLED_GHAST3],
    ["i've killed two ghasts now.", NS_STAGE.KILLED_GHAST2],
    ['the druid pouch made a ghast appear', NS_STAGE.KILLED_GHAST1],
    ['them into a druid pouch', NS_STAGE.ADDED_POUCH],
    ['i collected some bloomed items from the swamp.', NS_STAGE.PICKED_SICKLE],
    ['i cast the bloom spell in the swamp.', NS_STAGE.CASTED_SICKLE_BLOOM],
    ['filliman has blessed the silver sickle for me.', NS_STAGE.BLESSED_SICKLE],
    ['filliman has turned into a nature spirit', NS_STAGE.FULL_TRANSFORM],
    ['i entered fillimans grotto as he asked me to.', NS_STAGE.ENTERED_GROTTO],
    ['he says that he can cast the spell now', NS_STAGE.PERFORMED_RITUAL],
    ['i collected a mort myre fungi.', NS_STAGE.PICKED_FUNGI],
    ["i've cast the bloom spell in the swamp.", NS_STAGE.CASTED_SPELL],
    ["i've been blessed at the temple by drezel.", NS_STAGE.BLESSED],
    // Why: a colour tag inside "'@dre@bloom'@dbl@ spell" normalises to a space, so the needle must not span it.
    ['spell but i need to be', NS_STAGE.RECEIVED_SPELL],
    ['might need my help with his plan', NS_STAGE.GIVEN_JOURNAL],
    ['to find his journal', NS_STAGE.SHOWN_MIRROR],
    ["i've found filliman's journal", NS_STAGE.SHOWN_MIRROR],
    ['convince this poor fellow', NS_STAGE.SPOKEN_FILLIMAN],
    ["i can't really communicate with this", NS_STAGE.FAILED_TALK],
    ['i need to look for filliman tarlock', NS_STAGE.STARTED],
    ['i can start this quest by speaking to', NS_STAGE.NOT_STARTED]
];

export function parseDruidJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = MARKERS.find(([needle]) => text.includes(needle));
    if (!hit) {
        return undefined;
    }
    const stage = hit[1];
    const flags = new Set<string>();
    if (text.includes('absorbed into the nature stone')) {
        flags.add(NS_FLAG.NATURE);
    }
    if (text.includes('absorbed into the spirit stone')) {
        flags.add(NS_FLAG.SPIRIT);
    }
    // Why: the stone lines are written at stages 50 and 55 alone; past the ritual both are facts the page stops stating.
    if (stage >= NS_STAGE.PERFORMED_RITUAL) {
        flags.add(NS_FLAG.NATURE);
        flags.add(NS_FLAG.SPIRIT);
    }
    return { stage, flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readDruidProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(NS_QUEST);
    if (status === 'complete') {
        return { stage: NS_STAGE.COMPLETE, flags: new Set([NS_FLAG.NATURE, NS_FLAG.SPIRIT]) };
    }
    if (status === 'notStarted') {
        return { stage: NS_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const lines = await Quests.journal(NS_QUEST);
    const progress = parseDruidJournal(lines);
    // Why: the swamp gate's refusal is a mesbox on main, and while one is up every journal read comes back empty.
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
