import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Quests } from '../../../api/hud/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const ELEMENTAL_WORKSHOP_QUEST = 'Elemental Workshop';

/**
 * Coarse stages from journal structure. Machinery sub-progress (water, bellows,
 * furnace) is carried as flags — the journal appends those paragraphs while the
 * entered branch is active.
 */
export const EW_STAGE = {
    NOT_STARTED: 0,
    READ_BOOK: 1,
    SLASHED: 2,
    ENTERED: 3,
    COMPLETE: 4
} as const;

export const EW_FLAG = {
    WATER: 'water-flowing',
    BELLOWS: 'bellows-fixed',
    FURNACE: 'furnace-lit',
    MADE_BAR: 'made-bar'
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function readFlags(text: string): Set<string> {
    const flags = new Set<string>();
    if (
        text.includes('waterwheel in the northern water')
        || text.includes('water wheel in the northern water')
        || text.includes('get the waterwheel')
        || text.includes('get the water wheel')
    ) {
        flags.add(EW_FLAG.WATER);
    }
    if (text.includes('bellows in the eastern air area are now fixed') || text.includes('stitch some leather')) {
        flags.add(EW_FLAG.BELLOWS);
    }
    if (text.includes('lit the furnace with lava') || text.includes('using the stone bowl')) {
        flags.add(EW_FLAG.FURNACE);
    }
    if (text.includes('made a bar from the elemental ore') || text.includes('just need to make something from it')) {
        flags.add(EW_FLAG.MADE_BAR);
    }
    return flags;
}

function readStage(text: string): number | undefined {
    // Newest branch first: later text retains earlier history.
    if (text.includes('quest complete!')) {
        return EW_STAGE.COMPLETE;
    }
    if (
        text.includes('secret door in the seers village smithy')
        || text.includes('there is obviously lots to do here')
        || text.includes('made a bar from the elemental ore')
        || text.includes('managed to get the waterwheel')
        || text.includes('managed to get the water wheel')
        || text.includes('bellows in the eastern air area')
        || text.includes('lit the furnace with lava')
    ) {
        return EW_STAGE.ENTERED;
    }
    if (
        text.includes('cutting open the spine of the book')
        || text.includes('key hidden under the leather binding')
    ) {
        return EW_STAGE.SLASHED;
    }
    if (
        text.includes('found a battered book')
        || text.includes('tells of magic ore and a workshop')
    ) {
        return EW_STAGE.READ_BOOK;
    }
    if (text.includes('i can start this quest by reading a')) {
        return EW_STAGE.NOT_STARTED;
    }
    return undefined;
}

export function parseElementalWorkshopJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    if (stage === undefined) {
        return undefined;
    }
    return { stage, flags: readFlags(text) };
}

export async function readElementalWorkshopProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(ELEMENTAL_WORKSHOP_QUEST);
    if (status === 'complete') {
        return { stage: EW_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: EW_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }

    const progress = parseElementalWorkshopJournal(await Quests.journal(ELEMENTAL_WORKSHOP_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
