import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';
import type { QuestProgress } from '../../engine/types.js';
import { HERO_NAME } from './areas.js';

/** `%heroquest`, numbered as `quest_hero.constant` numbers it. */
export const HERO_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    PHOENIX_SPOKEN: 2,
    PHOENIX_ALFONSE: 3,
    PHOENIX_CHARLIE: 4,
    PHOENIX_KILLED_GRIP: 5,
    PHOENIX_ARMBAND: 6,
    BLACKARM_SPOKEN: 7,
    BLACKARM_HQ: 8,
    BLACKARM_PAPERS: 9,
    BLACKARM_MANSION: 10,
    BLACKARM_PAPERS_GIVEN: 11,
    BLACKARM_LOOTED: 12,
    BLACKARM_ARMBAND: 13,
    COMPLETE: 14
} as const;

// Why: colour tags become a space, so no needle may span a tag boundary, and every needle below opens
// with one, because "she gave me" contains "he gave me".
function normalize(lines: readonly string[] | string): string {
    const body = (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
    return body.length === 0 ? '' : ` ${body} `;
}

// Why: the page keeps every earlier line struck through, so this order is what separates the stages —
// each needle is that stage's own next-step line, which no later page repeats.
const STAGES: readonly [string, number][] = [
    [' quest complete!', HERO_STAGE.COMPLETE],
    [' in reward she gave me a master thief', HERO_STAGE.BLACKARM_ARMBAND],
    [' to prove my skills', HERO_STAGE.PHOENIX_ARMBAND],
    [' after rewarding the player who assisted me', HERO_STAGE.BLACKARM_LOOTED],
    [' i can move around the hideout', HERO_STAGE.BLACKARM_PAPERS_GIVEN],
    // Why: "presented myself to" is the struck-through line at every later stage, and it does not contain this.
    [' need to present myself to', HERO_STAGE.BLACKARM_MANSION],
    [' disguise myself as', HERO_STAGE.BLACKARM_PAPERS],
    [' speak to other gang members', HERO_STAGE.BLACKARM_HQ],
    [' say the password she gave me', HERO_STAGE.BLACKARM_SPOKEN],
    [' as soon as they have given me my', HERO_STAGE.PHOENIX_KILLED_GRIP],
    [' help me get through this door', HERO_STAGE.PHOENIX_CHARLIE],
    [' speak to charlie round the back', HERO_STAGE.PHOENIX_ALFONSE],
    [' use the password he gave me at', HERO_STAGE.PHOENIX_SPOKEN],
    // Why: the phoenix intro line renders at every phoenix stage, so it can only be read as STARTED
    // once every later phoenix needle above has missed.
    [' i should visit their hideout', HERO_STAGE.STARTED],
    [' leader of the black arm gang', HERO_STAGE.STARTED],
    [' i can start this quest by speaking to', HERO_STAGE.NOT_STARTED],
    [' will let me into the', HERO_STAGE.STARTED]
];

// Why: the three item lines are driven by `~obj_gettotal`, which counts the bank as well as the pack,
// so they say the item exists somewhere — never that it is carried.
const FLAGS: readonly [string, string][] = [
    [' firebird feather - i now have one', 'feather'],
    [' cooked lava eel - i now have one', 'eel'],
    [' armband - i now have one', 'armband'],
    [' i have all required items', 'ready-to-hand-in']
];

export function parseHeroQuestJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    if (text.length === 0) {
        return undefined;
    }
    const hit = STAGES.find(([needle]) => text.includes(needle));
    if (!hit) {
        return undefined;
    }
    const flags = new Set<string>();
    for (const [needle, flag] of FLAGS) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    return { stage: hit[1], flags };
}

/** A failed read is not evidence the quest went backwards. */
let lastGood: QuestProgress | undefined;

/** Test seam: the last good read is memoised for the process. */
export function resetHeroQuestProgress(): void {
    lastGood = undefined;
}

export async function readHeroQuestProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(HERO_NAME);
    if (status === 'complete') return { stage: HERO_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: HERO_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseHeroQuestJournal(await Quests.journal(HERO_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (progress) {
        lastGood = progress;
    }
    return progress ?? lastGood;
}
