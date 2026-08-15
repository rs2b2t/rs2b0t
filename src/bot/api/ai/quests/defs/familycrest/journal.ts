import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { FC_QUEST, FC_STAGE } from './areas.js';

/**
 * `@dbl@`-style colour tags become a space, so a needle must never span a tag
 * boundary that sits next to punctuation.
 * @see docs/reference/quest-engine.md#quest-state
 */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Newest marker first: crest_journal.rs2 appends, so every earlier stage's prose
 * is still on the scroll at the later ones.
 */
function readStage(text: string): number | undefined {
    if (text.includes('quest complete!')) return FC_STAGE.COMPLETE;
    if (text.includes('lost his piece of the family crest to a demon')) return FC_STAGE.CURED_JOHNATHON;
    if (text.includes('he soon recovered when i used an antipoison')) return FC_STAGE.CURED_JOHNATHON;
    if (text.includes('looking very ill at the jolly boar inn')) return FC_STAGE.SPOKEN_JOHNATHON;
    if (text.includes('final crest piece is with their brother')) return FC_STAGE.AVAN_PIECE;
    if (text.includes('gave me his crest piece in return for a ruby ring')) return FC_STAGE.AVAN_PIECE;
    if (text.includes('will give me his crest piece if i can bring him a ruby')) return FC_STAGE.SPOKEN_BOOT;
    if (text.includes('i should find a dwarf named')) return FC_STAGE.SPOKEN_AVAN;
    if (text.includes('told me that avan is wearing a')) return FC_STAGE.SPOKEN_GEM_TRADER;
    if (text.includes('is on a treasure hunt in the')) return FC_STAGE.CALEB_WHERE;
    if (text.includes('crest piece, i need to find the other')) return FC_STAGE.CALEB_PIECE;
    if (text.includes('will let me have his piece in return for')) return FC_STAGE.SPOKEN_CALEB;
    if (text.includes('i need to find his son')) return FC_STAGE.SPOKEN_DIMINTHEIS;
    if (text.includes('i can start this quest')) return FC_STAGE.NOT_STARTED;
    return undefined;
}

export function parseFamilyCrestJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const stage = readStage(normalize(lines));
    return stage === undefined ? undefined : { stage, flags: new Set() };
}

/**
 * A failed read is not evidence the quest went backwards, so the last good one
 * stands in until the next success.
 */
let lastGood: QuestProgress | undefined;

export interface JournalRead {
    reads: number;
    failures: number;
    cached: boolean;
    stage?: number;
}

export const journalRead: JournalRead = { reads: 0, failures: 0, cached: false };

export function describeJournal(): string {
    const { stage, cached, failures, reads } = journalRead;
    return `stage=${stage ?? '?'}${cached ? ' (CACHED — this read failed)' : ''}`
        + `${failures > 0 ? ` reads=${reads} failures=${failures}` : ''}`;
}

export async function readFamilyCrestProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(FC_QUEST);
    if (status === 'complete') return { stage: FC_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: FC_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal(FC_QUEST);
    const progress = parseFamilyCrestJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    journalRead.reads++;
    journalRead.cached = progress === undefined;
    if (progress) {
        lastGood = progress;
    } else {
        journalRead.failures++;
    }
    const used = progress ?? lastGood;
    journalRead.stage = used?.stage;
    return used;
}
