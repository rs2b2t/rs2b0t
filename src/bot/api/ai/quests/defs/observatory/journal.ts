import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { OBS_QUEST, OBS_STAGE } from './areas.js';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: `itgronigen_journal.rs2` appends, so every earlier stage's text is still on the page and only the newest paragraph separates one stage from the next.
// Why: the tests run highest-first for that reason — the completion page still lists "1 lens mould", and the lens page still says "molten glass".
const MARKERS: readonly { stage: number; text: string }[] = [
    { stage: OBS_STAGE.COMPLETE, text: 'quest complete!' },
    { stage: OBS_STAGE.SENT_TELESCOPE, text: 'gone ahead to the observatory' },
    { stage: OBS_STAGE.GIVEN_MOULD, text: 'create the lens by using the molten glass' },
    { stage: OBS_STAGE.GIVEN_GLASS, text: '1 lens mould' },
    { stage: OBS_STAGE.GIVEN_BRONZE, text: '1 molten glass' },
    { stage: OBS_STAGE.GIVEN_PLANKS, text: '1 bronze bar' },
    { stage: OBS_STAGE.STARTED, text: '3 wooden planks' },
    { stage: OBS_STAGE.NOT_STARTED, text: 'i can start this quest by talking to the' }
];

/** The `%itgronigen` value the rendered journal describes, or undefined for an unreadable page. */
export function parseObservatoryJournal(lines: readonly string[] | string): number | undefined {
    const text = normalize(lines);
    return MARKERS.find(m => text.includes(m.text))?.stage;
}

export async function readObservatoryStage(): Promise<number | undefined> {
    const status = Quests.status(OBS_QUEST);
    if (status === 'complete') {
        return OBS_STAGE.COMPLETE;
    }
    if (status === 'notStarted') {
        return OBS_STAGE.NOT_STARTED;
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const stage = parseObservatoryJournal(await Quests.journal(OBS_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}
