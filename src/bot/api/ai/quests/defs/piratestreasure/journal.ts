import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { PT_QUEST, PT_STAGE } from './areas.js';

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function readStage(text: string): number | undefined {
    if (text.includes('quest complete!')) return PT_STAGE.COMPLETE;
    if (text.includes('the note reads')) return PT_STAGE.READ_NOTE;
    if (text.includes('i have given the rum to')) return PT_STAGE.RECEIVED_KEY;
    if (text.includes('he has agreed to tell me')) return PT_STAGE.FETCH_RUM;
    if (text.includes('i can start this quest by speaking to')) return PT_STAGE.NOT_STARTED;
    return undefined;
}

// Why: the page keeps every earlier line struck through, so an early needle still matches in a late state and this order is the only thing that separates them.
// Why: `rum-lost` leads because the lost-rum page is reachable with every shipping line already behind it.
const SMUGGLE: readonly [string, string][] = [
    ['but i seem to have lost it', 'rum-lost'],
    ['i should take it to redbeard frank', 'rum-in-hand'],
    ["i have taken a job at wydin's store", 'store-job'],
    ['the crate has been shipped to', 'rum-shipped'],
    ['in the crate and filled it with bananas', 'crate-full'],
    ['i should fill it with', 'rum-in-crate'],
    ['hide my rum in the next crate', 'rum-held-employed'],
    ['now all i need is some rum', 'employed-need-rum'],
    ['find a way to get the rum off', 'rum-held-unemployed'],
    ['and buy some rum', 'need-rum']
];

export function parsePiratesTreasureJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    if (stage === undefined) {
        return undefined;
    }
    const flags = new Set<string>();
    if (stage === PT_STAGE.FETCH_RUM) {
        const hit = SMUGGLE.find(([needle]) => text.includes(needle));
        if (hit) {
            flags.add(hit[1]);
        }
    }
    return { stage, flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readPiratesTreasureProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(PT_QUEST);
    if (status === 'complete') return { stage: PT_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: PT_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parsePiratesTreasureJournal(await Quests.journal(PT_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
