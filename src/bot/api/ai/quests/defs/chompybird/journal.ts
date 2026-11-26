import { questProgressAt, readQuestJournal, type JournalCache } from '../../journalReader.js';
import { normalizeJournal as normalize } from '../../journalText.js';
import type { QuestProgress } from '../../engine/types.js';
import { CB_QUEST, CB_STAGE } from './areas.js';

// Why: `chompybird_journal.rs2` appends earlier text, so test stage markers newest-first.
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

/** A failed read doesn't mean the quest went backwards. */
const cache: JournalCache<QuestProgress> = {};

export function readChompyProgress(): Promise<QuestProgress | undefined> {
    return readQuestJournal(CB_QUEST, CB_STAGE, parseChompyJournal, questProgressAt, cache);
}
