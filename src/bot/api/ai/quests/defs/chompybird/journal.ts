import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { CB_QUEST, CB_STAGE } from './areas.js';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: chompybird_journal.rs2 appends, so every earlier stage's prose is still on the page — newest marker first, or an early line answers for a late stage.
// Why: 15/20, 30/35 and 40/45 render identically; the step each pair wants is the same one, and the bow in the pack separates 40 from 45 where it matters.
const MARKERS: readonly [string, number][] = [
    ['quest complete!', CB_STAGE.COMPLETE],
    ["i've cooked the chompy", CB_STAGE.CHOMPY_COOKED],
    ['i showed rantz the chompy', CB_STAGE.TOLD_TO_COOK],
    ["i've killed a chompy bird!", CB_STAGE.KILLED_CHOMPY],
    ['has lent me an ogre bow', CB_STAGE.GOT_BOW],
    ["doesn't seem to be a very good shot", CB_STAGE.RANTZ_MISSED],
    ['i dropped a fatsy toady on the spot', CB_STAGE.DROPPED_TOAD],
    ["i managed to trap some 'fatsy toadies'", CB_STAGE.SHOWN_TOAD],
    ["rantz told me 'fatsy toadies' grow fat on swamp gas", CB_STAGE.KIDS_PLAY_WITH_TOAD],
    ["it turned out that 'stabbers' are a kind of specially made", CB_STAGE.GIVEN_ARROWS],
    ["i agreed to get rants some 'stabbers'", CB_STAGE.STARTED],
    ['i can start this quest by speaking to the ogre', CB_STAGE.NOT_STARTED]
];

export function parseChompyJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const hit = MARKERS.find(([needle]) => text.includes(needle));
    return hit ? { stage: hit[1], flags: new Set<string>() } : undefined;
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readChompyProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(CB_QUEST);
    if (status === 'complete') {
        return { stage: CB_STAGE.COMPLETE, flags: new Set<string>() };
    }
    if (status === 'notStarted') {
        return { stage: CB_STAGE.NOT_STARTED, flags: new Set<string>() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseChompyJournal(await Quests.journal(CB_QUEST));
    // Why: the ogre chest, the bait refusal and every objbox in Rantz's chain sit on main, and while one is up the journal read comes back empty.
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
