import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { FT_NAME } from './areas.js';

/** `stage` is the vote count Brundt is holding, which is what the journal renders. */
export const FT_STAGE = { NOT_STARTED: -1, COMPLETE: 100 } as const;

export const TRIALS = ['navigator', 'merchant', 'hunter', 'seer', 'warrior', 'reveller', 'bard'] as const;

export type Trial = (typeof TRIALS)[number];

/** The journal names each councillor by role, so these are the words to match, not the NPC names. */
const ROLE: Record<Trial, string> = {
    navigator: 'navigator',
    merchant: 'merchant',
    hunter: 'hunter',
    seer: 'seer',
    warrior: 'warrior',
    reveller: 'reveller',
    bard: 'bard'
};

/** Where the flower trade has got to, newest step first — only one of these renders at a time. */
const MERCHANT_STEPS: readonly [string, string][] = [
    ['all askeladden wants is some money', 'thora'],
    ['the reveller is looking for a legendary cocktail', 'manni'],
    ['the warrior is looking for a champions token', 'thorvald'],
    ['the seer is looking for a warrior to be his bodyguard', 'seer'],
    ['the navigator is looking for a weather forecast', 'swensen'],
    ['the fisherman is looking for a map of fishing spots', 'fisherman'],
    ['the armourer is looking for a rare inedible fish', 'skul'],
    ['the hunter is looking for a custom bowstring', 'sigli'],
    ['the chieftan wants a map of new hunting grounds', 'chief'],
    ['the shopkeeper is looking for a tax reduction', 'yrsa'],
    ['the bard is looking for some new boots', 'olaf']
];

const VOTES: readonly [string, number][] = [
    ['i have seven votes', 7],
    ['i have six votes so far', 6],
    ['i have five votes so far', 5],
    ['i have four votes so far', 4],
    ['i have three votes so far', 3],
    ['i have two votes so far', 2],
    ['i have one vote so far', 1],
    ["i don't have any votes yet", 0]
];

/** Colour tags become a space, so no needle may span a tag boundary. */
function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

export function parseFremennikJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    if (text.includes('quest complete!')) {
        return { stage: FT_STAGE.COMPLETE, flags: new Set() };
    }
    if (!text.includes('council')) {
        return undefined;
    }
    const flags = new Set<string>();
    for (const trial of TRIALS) {
        if (text.includes(`i now have the ${ROLE[trial]}'s vote`)) {
            flags.add(`${trial}-done`);
        } else if (text.includes(`the ${ROLE[trial]} will vote for me if i can pass his trial`)) {
            flags.add(`${trial}-started`);
        }
    }
    const step = MERCHANT_STEPS.find(([needle]) => text.includes(needle));
    if (step) {
        flags.add(`merchant-at:${step[1]}`);
    }
    const votes = VOTES.find(([needle]) => text.includes(needle));
    return { stage: votes ? votes[1] : 0, flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

export function resetFremennikJournalCache(): void {
    lastGood = undefined;
}

export async function readFremennikProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(FT_NAME);
    if (status === 'complete') return { stage: FT_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: FT_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseFremennikJournal(await Quests.journal(FT_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
