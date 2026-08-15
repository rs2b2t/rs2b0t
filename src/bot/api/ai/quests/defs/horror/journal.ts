import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { HD_QUEST, HD_STAGE } from './areas.js';

/** Journal sub-progress this module branches on. */
export const HD_FLAG = {
    BRIDGE: 'bridge',
    KEY: 'key',
    GLASS: 'glass',
    TAR: 'tar',
    LIGHT: 'light'
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: `@str@` is the only oracle for the bridge, so everything else is stripped.
// Why: `~quest_journal` runs the page through `split_init` and the wrapper re-emits the active tags at the head of every line it produces.
// Why: the struck bridge line therefore arrives as `@str@@bla@I need to repair…`, so the strike marker is not adjacent to its own words and cannot be matched with the tags left in.

/** Normalise journal lines, keeping only the `@str@` marker. */
function struck(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@(?!str@)[a-z0-9]{3}@/gi, '')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const BRIDGE_DONE = /@str@\s*i need to repair the bridge/;

/**
 * Newest marker first: horror_journal.rs2 appends, so every earlier stage's
 * prose is still on the scroll at the later ones.
 */
function readStage(text: string): number | undefined {
    if (text.includes('quest complete!')) return HD_STAGE.COMPLETE;
    if (text.includes('i must defeat these sea monsters')) return HD_STAGE.DEFEATED_DAGJR;
    if (text.includes('i found jossik in an underground cavern')) return HD_STAGE.DEFEATED_DAGJR;
    if (text.includes('i must search this place')) return HD_STAGE.REPAIRED_LIGHTHOUSE;
    if (text.includes('i managed to repair the lighthouse light')) return HD_STAGE.REPAIRED_LIGHTHOUSE;
    if (text.includes('now i need to find some way of')) return HD_STAGE.ENTERED_LIGHTHOUSE;
    if (text.includes('i repaired the bridge leading to rellekka and got a key')) return HD_STAGE.ENTERED_LIGHTHOUSE;
    if (text.includes('larrissa is very worried about her boyfriend')) return HD_STAGE.STARTED;
    if (text.includes('i can start this quest by speaking to')) return HD_STAGE.NOT_STARTED;
    return undefined;
}

// Why: both branches of the bridge line say the same words and only the colour tag differs, `@str@` for done against `@dbl@` for outstanding.
// Why: that one flag is therefore read off the tagged text rather than the normalised text.

/** Read the journal's progress flags. */
function readFlags(text: string, tagged: string): Set<string> {
    const flags = new Set<string>();
    if (BRIDGE_DONE.test(tagged)) {
        flags.add(HD_FLAG.BRIDGE);
    }
    if (text.includes('use the key i got from gunnjorn')) {
        flags.add(HD_FLAG.KEY);
    }
    if (text.includes('i have fixed the lighthouse lens')) {
        flags.add(HD_FLAG.GLASS);
    }
    if (text.includes('i have re-tarred the lighthouse torch')) {
        flags.add(HD_FLAG.TAR);
    }
    if (text.includes('i have relit the lighthouse torch')) {
        flags.add(HD_FLAG.LIGHT);
    }
    return flags;
}

export function parseHorrorJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    if (stage === undefined) {
        return undefined;
    }
    const flags = readFlags(text, struck(lines));
    // Why: past the bridge stage the journal folds both errands into one struck-out line, so the flags have to be re-asserted or every later decide() reads the bridge as unbuilt.
    if (stage >= HD_STAGE.ENTERED_LIGHTHOUSE) {
        flags.add(HD_FLAG.BRIDGE);
        flags.add(HD_FLAG.KEY);
    }
    if (stage >= HD_STAGE.REPAIRED_LIGHTHOUSE) {
        flags.add(HD_FLAG.GLASS);
        flags.add(HD_FLAG.TAR);
        flags.add(HD_FLAG.LIGHT);
    }
    return { stage, flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export async function readHorrorProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(HD_QUEST);
    if (status === 'complete') {
        return { stage: HD_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: HD_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }

    const lines = await Quests.journal(HD_QUEST);
    const progress = parseHorrorJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
