import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import { hasFlag, type QuestProgress } from '../../engine/types.js';
import { TROLL_FLAG, TROLL_QUEST, parseTrollStrongholdJournal } from '../trollstronghold/journal.js';

/** Matches content `eadgar_quest` varp stages. */
export const EADGAR_STAGE = {
    NOT_STARTED: 0,
    STARTED: 10,
    SPOKE_EADGAR: 15,
    SPOKE_BURNTMEAT_FIRST: 20,
    SPOKE_BURNTMEAT: 25,
    NEEDS_PARROT: 30,
    EXPLAINED_PLAN: 50,
    HID_PARROT: 60,
    NEEDS_ITEMS: 70,
    NEEDS_POTION: 80,
    NEEDS_PARROT_BACK: 85,
    GOT_PARROT_BACK: 86,
    GOT_FAKE_MAN: 87,
    GOT_BURNT_MEAT: 90,
    UNLOCKED_STOREROOM: 100,
    COMPLETE: 110
} as const;

export const EADGAR_QUEST = "Eadgar's Ruse";

export const EADGAR_FLAG = {
    NEED_LOGS: 'need-logs',
    NEED_CHICKENS: 'need-chickens',
    NEED_GRAIN: 'need-grain',
    NEED_CLOTHES: 'need-clothes',
    POTION_MADE: 'potion-made',
    HAVE_GOUTWEED: 'have-goutweed',
    /** Eadgar is out of his cell and standing in his cave, so the quest can be run at all. */
    EADGAR_FREED: 'eadgar-freed'
} as const;

/** Everything the scarecrow still needs, when the journal is printing the list. */
export const SCARECROW_NEED = { logs: 1, chickens: 5, grain: 10, clothes: 1 } as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the needs list repeats words the struck-through history also uses, so it is read from
// the tail after "i still need to bring him:" rather than from the journal at large.
function readNeeds(text: string): Set<string> {
    const flags = new Set<string>();
    const at = text.indexOf('i still need to bring him');
    if (at < 0) {
        return flags;
    }
    const tail = text.slice(at);
    if (/(?:^|\s)logs(?:\s|$)/.test(tail)) {
        flags.add(EADGAR_FLAG.NEED_LOGS);
    }
    const chickens = /(\d+) raw chickens?/.exec(tail);
    if (chickens) {
        flags.add(`${EADGAR_FLAG.NEED_CHICKENS}:${chickens[1]}`);
    }
    const grain = /(\d+) (?:sheaves of grains|sheaf of grain)/.exec(tail);
    if (grain) {
        flags.add(`${EADGAR_FLAG.NEED_GRAIN}:${grain[1]}`);
    }
    if (tail.includes('some dirty clothes')) {
        flags.add(EADGAR_FLAG.NEED_CLOTHES);
    }
    return flags;
}

function readFlags(text: string, stage: number): Set<string> {
    const flags = stage === EADGAR_STAGE.NEEDS_ITEMS ? readNeeds(text) : new Set<string>();
    if (text.includes('i made the troll potion. i should go give it')) {
        flags.add(EADGAR_FLAG.POTION_MADE);
    }
    if (text.includes('i snuck into the storeroom and got some goutweed')) {
        flags.add(EADGAR_FLAG.HAVE_GOUTWEED);
    }
    return flags;
}

// Why: the journal keeps every earlier line struck through, so the newest phrase has to match first.
function readStage(text: string): number | undefined {
    if (text.includes('quest complete!')) {
        return EADGAR_STAGE.COMPLETE;
    }
    if (text.includes("i've unlocked the storeroom")) {
        return EADGAR_STAGE.UNLOCKED_STOREROOM;
    }
    if (text.includes('key to the storeroom is in a')) {
        return EADGAR_STAGE.GOT_BURNT_MEAT;
    }
    if (text.includes("i got eadgar's fake man")) {
        return EADGAR_STAGE.GOT_FAKE_MAN;
    }
    if (text.includes('i fetched the parrot back from the troll prison rack')) {
        return EADGAR_STAGE.GOT_PARROT_BACK;
    }
    if (text.includes('i made the troll potion and gave it to mad eadgar')) {
        return EADGAR_STAGE.NEEDS_PARROT_BACK;
    }
    if (text.includes('i gave eadgar everything he needed')) {
        return EADGAR_STAGE.NEEDS_POTION;
    }
    if (text.includes('i still need to bring him')) {
        return EADGAR_STAGE.NEEDS_ITEMS;
    }
    if (text.includes('i hid the parrot under the rack in the troll prison')) {
        return EADGAR_STAGE.HID_PARROT;
    }
    if (text.includes('i got the parrot eadgar wanted')) {
        return EADGAR_STAGE.EXPLAINED_PLAN;
    }
    if (text.includes('mad eadgar has a plan')) {
        return EADGAR_STAGE.NEEDS_PARROT;
    }
    if (text.includes('the troll cook will tell me how to find goutweed')) {
        return EADGAR_STAGE.SPOKE_BURNTMEAT;
    }
    if (text.includes('i should ask the troll cook')) {
        return EADGAR_STAGE.SPOKE_EADGAR;
    }
    if (text.includes('sanfew asked me to find him some goutweed')) {
        return EADGAR_STAGE.STARTED;
    }
    if (text.includes('i can start this quest')) {
        return EADGAR_STAGE.NOT_STARTED;
    }
    return undefined;
}

/**
 * Map quest-list journal text to varp-aligned stages plus sub-progress flags.
 * @see Server content eadgar_journal.rs2
 */
export function parseEadgarJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    if (stage === undefined) {
        return undefined;
    }
    return { stage, flags: readFlags(text, stage) };
}

async function closeJournal(): Promise<void> {
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
}

// Why: Troll Stronghold can be finished without ever opening Mad Eadgar's cell, and an unfreed Eadgar leaves the Cave Entrance dropping the character into an empty room with nobody to talk to.
// Why: the completed Troll Stronghold journal still records it — "I've rescued Godric and Mad Eadgar."
// Why: it is read once and cached, as every read opens and closes the quest-list modal.
let freedCache: boolean | undefined;

/** Called by the recovery that opens the cell, so the journal is not read again. */
export function markEadgarFreed(): void {
    freedCache = true;
}

async function trollFreedEadgar(): Promise<boolean> {
    if (freedCache !== undefined) {
        return freedCache;
    }
    const status = Quests.status(TROLL_QUEST);
    if (status !== 'complete' && status !== 'inProgress') {
        return false;
    }
    const progress = parseTrollStrongholdJournal(await Quests.journal(TROLL_QUEST));
    await closeJournal();
    freedCache = hasFlag(progress, TROLL_FLAG.FREED_EADGAR);
    return freedCache;
}

export async function readEadgarProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(EADGAR_QUEST);
    if (status === 'complete') {
        return { stage: EADGAR_STAGE.COMPLETE, flags: new Set() };
    }
    if (status !== 'inProgress' && status !== 'notStarted') {
        return undefined;
    }

    const freed = await trollFreedEadgar();
    if (status === 'notStarted') {
        return { stage: EADGAR_STAGE.NOT_STARTED, flags: freed ? new Set([EADGAR_FLAG.EADGAR_FREED]) : new Set() };
    }

    const progress = parseEadgarJournal(await Quests.journal(EADGAR_QUEST));
    await closeJournal();
    if (!progress) {
        return undefined;
    }
    const flags = new Set(progress.flags);
    if (freed) {
        flags.add(EADGAR_FLAG.EADGAR_FREED);
    }
    return { stage: progress.stage, flags };
}
