// docs/QUESTS.md
import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { ORDINAL, SHEEP, type SheepIndex } from './areas.js';

export const QUEST = 'Sheep Herder';

/** `^sheepherder_*` from `quest.constant`. */
export const SH_STAGE = { NOT_STARTED: 0, NEED_SUIT: 1, DISPOSING: 2, COMPLETE: 3 } as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

function allBurnt(): Set<string> {
    return new Set(SHEEP.map(n => `burnt-${n}`));
}

// Why: the journal renders one line per sheep, and the three it can render name herded, killed and incinerated — which is every state the module has to tell apart.
// Why: the "killed" line ends on a colour tag before "bones", so no needle may span it.
function sheepFlags(text: string, n: SheepIndex): string[] {
    const ord = ORDINAL[n];
    if (text.includes(`killed the ${ord} sheep and incinerated its bones`)) {
        return [`herded-${n}`, `killed-${n}`, `burnt-${n}`];
    }
    if (text.includes(`killed the ${ord} sheep. now i must incinerate`)) {
        return [`herded-${n}`, `killed-${n}`];
    }
    if (text.includes(`herded the ${ord} sheep to the pen`)) {
        return [`herded-${n}`];
    }
    return [];
}

export function parseSheepHerderJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.includes('quest complete!')) {
        return { stage: SH_STAGE.COMPLETE, flags: allBurnt() };
    }
    if (text.includes('i can start this quest by speaking to')) {
        return { stage: SH_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (text.includes('i need to get some protective clothing')) {
        return { stage: SH_STAGE.NEED_SUIT, flags: new Set() };
    }
    if (!text.includes('i bought some protective clothing')) {
        return undefined;
    }
    // Why: the last page drops the per-sheep lines for one summary, so its own line is the only evidence all four are burnt.
    if (text.includes('i should return to')) {
        return { stage: SH_STAGE.DISPOSING, flags: allBurnt() };
    }
    const flags = new Set<string>();
    for (const n of SHEEP) {
        for (const flag of sheepFlags(text, n)) {
            flags.add(flag);
        }
    }
    return { stage: SH_STAGE.DISPOSING, flags };
}

export async function readSheepHerderProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST);
    if (status === 'complete') {
        return { stage: SH_STAGE.COMPLETE, flags: allBurnt() };
    }
    if (status === 'notStarted') {
        return { stage: SH_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }
    const progress = parseSheepHerderJournal(await Quests.journal(QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
