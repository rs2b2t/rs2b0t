import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { TBWT_QUEST, TB_LUBUFU, TB_MAIN, TB_TAMAYU, TB_TINSAY, TB_VARP } from './areas.js';

/** Journal sub-progress this module branches on, alongside the two transmitted varps. */
export const TB_FLAG = {
    TIADECHE: 'tiadeche',
    TINSAY: 'tinsay',
    TAMAYU: 'tamayu',
    LUBUFU: 'lubufu',
    /** Tamayu has drunk his four doses of agility potion. */
    AGILITY: 'agility',
    /** Tamayu is holding a spear that is both strong enough and Karambwan-poisoned. */
    SPEAR: 'spear'
} as const;

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const LABELS = ['tiadeche', 'tinsay', 'tamayu', 'lubufu'] as const;

// Why: every brother's block is appended to the same page in a fixed order, and "Nothing of interest." is the intro line for three of them — so a marker is only meaningful inside its own section.

/** The slice of the page between one brother's heading and the next. */
function section(text: string, label: string): string {
    const start = text.indexOf(`${label}:`);
    if (start < 0) {
        return '';
    }
    let end = text.length;
    for (const other of LABELS) {
        const at = text.indexOf(`${other}:`, start + label.length + 1);
        if (at >= 0 && at < end) {
            end = at;
        }
    }
    return text.slice(start, end);
}

/** Newest marker first: every later stage re-prints the lines of the ones before it. */
function firstMatch(text: string, markers: readonly [string, number][]): number | null {
    return markers.find(([needle]) => text.includes(needle))?.[1] ?? null;
}

const TINSAY_MARKERS: readonly [string, number][] = [
    ['marinated in karambwanji paste.', TB_TINSAY.COMPLETE],
    ['he requires burnt jogre bones', TB_TINSAY.FETCH_BONES],
    ['i have given him a seaweed in monkey skin sandwich.', TB_TINSAY.GIVEN_SANDWICH],
    ['he requires a seaweed in monkey skin sandwich', TB_TINSAY.FETCH_SANDWICH],
    ['i have given him sliced banana in karamja rum.', TB_TINSAY.GIVEN_RUM],
    ['he requires banana in karamja rum', TB_TINSAY.FETCH_RUM],
    ['nothing of interest.', TB_TINSAY.INTRO]
];

const TAMAYU_MARKERS: readonly [string, number][] = [
    ['tamayu has slain the shaikahan!', TB_TAMAYU.COMPLETE],
    ['he appears to be having difficulty in the hunt.', TB_TAMAYU.WATCHED_CUTSCENE],
    ['once he has slain', TB_TAMAYU.SLAY_SHAIKAHAN],
    ['nothing of interest.', TB_TAMAYU.INTRO]
];

// Why: `became_apprentice` and `complete` render the same page, and the first is a single tick inside the second's own dialogue, so both read as complete.
const LUBUFU_MARKERS: readonly [string, number][] = [
    ["i have accepted lubufu's offer.", TB_LUBUFU.COMPLETE],
    ['lubufu has offered to train me as his apprentice.', TB_LUBUFU.OFFERED_APPRENTICE],
    ['i have given lubufu 20 karambwanji.', TB_LUBUFU.GIVEN_KARAMBWANJI],
    ['i need to give lubufu 20 karambwanji.', TB_LUBUFU.FETCH_KARAMBWANJI],
    ['lubufu has accepted', TB_LUBUFU.FETCH_KARAMBWANJI],
    ['i have offered to help collect bait', TB_LUBUFU.OFFERED_TO_HELP],
    ['lubufu is a crochety old fisherman', TB_LUBUFU.INITIAL_OPS]
];

/**
 * Sub-progress for the three brothers the client has no varp for; `main` and `tiadeche` come from their transmitted varps.
 * Why: undefined marks a page that did not render, which a quest at zero would otherwise be read as.
 */
export function parseTbwtJournal(lines: readonly string[] | string): Set<string> | undefined {
    const text = normalize(lines);
    // Every in-progress page opens by naming the three sons; a blank read is a modal that never opened.
    if (!text.includes('sons of')) {
        return undefined;
    }
    const flags = new Set<string>();

    const tinsay = firstMatch(section(text, 'tinsay'), TINSAY_MARKERS);
    flags.add(`${TB_FLAG.TINSAY}:${tinsay ?? TB_TINSAY.UNKNOWN}`);

    const tamayuText = section(text, 'tamayu');
    const tamayu = firstMatch(tamayuText, TAMAYU_MARKERS);
    flags.add(`${TB_FLAG.TAMAYU}:${tamayu ?? TB_TAMAYU.UNKNOWN}`);
    if (tamayuText.includes('i have increased his agility')) {
        flags.add(TB_FLAG.AGILITY);
    }
    if (tamayuText.includes('karambwan poisoned spear')) {
        flags.add(TB_FLAG.SPEAR);
    }
    // Why: the two lines are only written while he is still hunting; past the kill the page states them unconditionally, and both are then facts.
    if (tamayu !== null && tamayu >= TB_TAMAYU.COMPLETE) {
        flags.add(TB_FLAG.AGILITY);
        flags.add(TB_FLAG.SPEAR);
    }

    // Why: the block is skipped entirely below `initial_ops`, so a missing section is "not spoken to yet", not a parse failure.
    const lubufu = firstMatch(section(text, 'lubufu'), LUBUFU_MARKERS);
    flags.add(`${TB_FLAG.LUBUFU}:${lubufu ?? TB_LUBUFU.UNKNOWN}`);

    return flags;
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export function resetTbwtProgressCache(): void {
    lastGood = undefined;
}

// Why: the journal is only opened during the brothers phase — before it the two varps say everything, and afterwards the quest is one talk from done.

export async function readTbwtProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(TBWT_QUEST);
    if (status === 'unknown') {
        return undefined;
    }
    if (status === 'complete') {
        return { stage: TB_MAIN.COMPLETE, flags: new Set() };
    }
    const main = reader.varp(TB_VARP.MAIN);
    const tiadeche = reader.varp(TB_VARP.TIADECHE);
    if (main !== TB_MAIN.STARTED) {
        return { stage: main, flags: new Set([`${TB_FLAG.TIADECHE}:${tiadeche}`]) };
    }

    const flags = parseTbwtJournal(await Quests.journal(TBWT_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    // A page that rendered nothing at all is a failed read, not a quest that went backwards.
    if (!flags) {
        return lastGood;
    }
    flags.add(`${TB_FLAG.TIADECHE}:${tiadeche}`);
    lastGood = { stage: main, flags };
    return lastGood;
}
