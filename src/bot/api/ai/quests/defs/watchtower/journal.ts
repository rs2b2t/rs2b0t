import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const WATCHTOWER_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    GIVEN_FINGERNAILS: 2,
    MADE_RELIC: 3,
    GIVEN_RELIC: 4,
    GIVEN_RIDDLE: 5,
    SOLVED_RIDDLE: 6,
    SKAVID_CRYSTAL: 7,
    FED_NIGHTSHADE: 8,
    LEARNED_POTION: 9,
    MADE_POTION: 10,
    FOUND_ALL_CRYSTALS: 11,
    COMPLETE: 13,
    READ_SCROLL: 14
} as const;

export const WATCHTOWER_QUEST = 'Watch Tower';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const FLAG_LINES: readonly [string, string][] = [
    ["i returned og's stolen gold", 'helped-og'],
    ['og wants me to', 'spoken-og'],
    ["i have og's", 'spoken-og'],
    ["i knocked out one of gorad's teeth", 'helped-grew'],
    ['grew wants me to', 'spoken-grew'],
    ["i have one of gorad's teeth", 'spoken-grew'],
    ['i gave the bones to toban', 'helped-toban'],
    ['toban wants the', 'spoken-toban'],
    ['i have the dragon bones', 'spoken-toban'],
    ['the north west guard wants', 'looking-relic'],
    ['the north-east guard wants', 'market-asked'],
    ['i gave the north-east guard a rock cake', 'market-paid'],
    ['i have it with me now, so i can navigate', 'has-map'],
    ['i have been taught a few words', 'learning-skavid'],
    ["'cur bidith' - 'ig'", 'learned-ig'],
    ["'gor cur' - 'ar'", 'learned-ar'],
    ["'bidith tanath' - 'cur'", 'learned-cur'],
    ["'gor nod' - 'nod'", 'learned-nod'],
    ['i have mined the sacred rock', 'mined-rock']
];

// The journal drops a tribe's "wants" line once that tribe is satisfied, so the
// helped-* line is the only evidence left that we ever spoke to them.
const IMPLIED: readonly [string, string][] = [
    ['helped-og', 'spoken-og'],
    ['helped-grew', 'spoken-grew'],
    ['helped-toban', 'spoken-toban']
];

function readFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const [needle, flag] of FLAG_LINES) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    for (const [source, implied] of IMPLIED) {
        if (flags.has(source)) {
            flags.add(implied);
        }
    }
    const kills = text.match(/kill (\d+) ogre shaman/);
    if (kills) {
        flags.add('shamans-left:' + kills[1]);
    } else if (text.includes('i killed all the ogre shamans')) {
        flags.add('shamans-left:0');
    }
    return flags;
}

function readStage(text: string): number | undefined {
    // Later entries retain the complete earlier history, so match newest first.
    if (text.includes('quest complete!')) return WATCHTOWER_STAGE.COMPLETE;
    if (text.includes('i have taken the crystals to the watchtower wizard')) return WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS;
    if (text.includes('he infused it into a magic ogre potion')) return WATCHTOWER_STAGE.MADE_POTION;
    // Needles avoid punctuation that sits next to a colour tag: stripping "@dbl@"
    // leaves a space before the mark, so "potion." normalises to "potion .".
    if (text.includes('i need to get it enchanted') || text.includes('i need to make the')) {
        return WATCHTOWER_STAGE.LEARNED_POTION;
    }
    if (text.includes('i need to defeat the ogre shamans and find the other')) return WATCHTOWER_STAGE.FED_NIGHTSHADE;
    if (text.includes("the other crystals are in the shamans' enclave")) return WATCHTOWER_STAGE.SKAVID_CRYSTAL;
    if (text.includes('i was given a map by the guard')) return WATCHTOWER_STAGE.SOLVED_RIDDLE;
    if (text.includes('some guards gave me a puzzle')) return WATCHTOWER_STAGE.GIVEN_RIDDLE;
    if (text.includes('i gave the ogre relic to the north west guard')) return WATCHTOWER_STAGE.GIVEN_RELIC;
    if (text.includes('now i need to deal with the tribal ogres')) return WATCHTOWER_STAGE.GIVEN_FINGERNAILS;
    if (text.includes('i accepted the challenge of finding the lost')) return WATCHTOWER_STAGE.STARTED;
    if (text.includes('i can start this quest')) return WATCHTOWER_STAGE.NOT_STARTED;
    return undefined;
}

export function parseWatchtowerJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStage(text);
    return stage === undefined ? undefined : { stage, flags: readFlags(text) };
}

export async function readWatchtowerProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(WATCHTOWER_QUEST);
    if (status === 'complete') return { stage: WATCHTOWER_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: WATCHTOWER_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseWatchtowerJournal(await Quests.journal(WATCHTOWER_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
