import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

/** Matches content `troll_quest` varp stages. */
export const TROLL_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    DEFEATED_DAD: 20,
    ENTERED_PRISON: 30,
    FREED_GODRIC: 40,
    COMPLETE: 50
} as const;

export const TROLL_QUEST = 'Troll Stronghold';

export const TROLL_FLAG = {
    BOOTS: 'boots',
    ENTERED_STRONGHOLD: 'entered-stronghold',
    HAS_PRISON_KEY: 'has-prison-key',
    FREED_EADGAR: 'freed-eadgar'
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
    if (text.includes('climbing boots from tenzing')) {
        flags.add(TROLL_FLAG.BOOTS);
    }
    if (text.includes('found my way into the troll stronghold')) {
        flags.add(TROLL_FLAG.ENTERED_STRONGHOLD);
    }
    if (text.includes('i have the prison key')) {
        flags.add(TROLL_FLAG.HAS_PRISON_KEY);
    }
    // Stage 30 prints "I've rescued Mad Eadgar."; stage 40 folds him into
    // "I've rescued Godric and Mad Eadgar." — match both, not the first.
    if (text.includes('rescued mad eadgar') || text.includes('and mad eadgar')) {
        flags.add(TROLL_FLAG.FREED_EADGAR);
    }
    return flags;
}

function readStage(text: string): number | undefined {
    // Newest progress first — later journal text retains earlier history.
    if (text.includes('quest complete!')) {
        return TROLL_STAGE.COMPLETE;
    }
    if (
        text.includes("i've rescued godric")
        || text.includes('rescued godric')
        || text.includes('return and tell dunstan')
        || text.includes('law talisman')
    ) {
        // Complete text also mentions the law talisman; COMPLETE already matched above.
        if (text.includes('i talked to dunstan and he gave me the law talisman')) {
            return TROLL_STAGE.COMPLETE;
        }
        return TROLL_STAGE.FREED_GODRIC;
    }
    if (text.includes('found my way into the prison') || text.includes('i have to rescue godric')) {
        return TROLL_STAGE.ENTERED_PRISON;
    }
    if (
        text.includes('defeated the troll champion')
        || text.includes('find a way to get into the troll stronghold')
        || text.includes('find a way to get into the prison')
        || text.includes('i have the prison key')
    ) {
        return TROLL_STAGE.DEFEATED_DAD;
    }
    if (
        text.includes('promised denulth')
        || text.includes('rescue godric from the troll stronghold')
        || text.includes('defeat the troll champion')
        || text.includes("accepted the troll champion's challenge")
    ) {
        return TROLL_STAGE.STARTED;
    }
    if (text.includes('i can start this quest')) {
        return TROLL_STAGE.NOT_STARTED;
    }
    return undefined;
}

/**
 * Map quest-list journal text to varp-aligned stages + sub-progress flags.
 * @see Server content troll_journal.rs2
 */
export function parseTrollStrongholdJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    if (stage === undefined) {
        return undefined;
    }
    return { stage, flags: readFlags(text) };
}

export async function readTrollStrongholdProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(TROLL_QUEST);
    if (status === 'complete') {
        return { stage: TROLL_STAGE.COMPLETE, flags: new Set() };
    }
    if (status === 'notStarted') {
        return { stage: TROLL_STAGE.NOT_STARTED, flags: new Set() };
    }
    if (status !== 'inProgress') {
        return undefined;
    }

    const progress = parseTrollStrongholdJournal(await Quests.journal(TROLL_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
