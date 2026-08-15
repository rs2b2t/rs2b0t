import { actions, reader } from '../../../../../adapter/ClientAdapter.js';
import { Execution } from '../../../../execution/Execution.js';
import { Quests } from '../../../../ui/questlog/Quests.js';

export const FIGHT_ARENA_QUEST = 'Fight Arena';

/** Mirrors `%arenaquest` in `quest_arena.constant`. Stages 4 and 7 are never set. */
export const FA_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    OBTAINED_ARMOUR: 2,
    SPOKEN_DRUNKGUARD: 3,
    GIVEN_KHALI_BREW: 5,
    ENTERED_OGRE_FIGHT: 6,
    DEFEATED_OGRE: 8,
    SENT_JAIL: 9,
    DEFEATED_SCORPION: 10,
    DEFEATED_BOUNCER: 11,
    FREED_SERVILS: 12,
    DEFEATED_KHAZARD: 13,
    COMPLETE: 14
} as const;

export function normalizeJournal(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

// Why: the journal keeps every earlier paragraph, so the newest line present is the stage and the order of this table is the parse.
// Why: no needle may end on punctuation, as a colour tag beside a mark normalises to a space between them.
const NEEDLES: readonly (readonly [string, number])[] = [
    ['quest complete!', FA_STAGE.COMPLETE],
    ['i eventually killed', FA_STAGE.DEFEATED_KHAZARD],
    ['challenged me to fight him, but i ran away', FA_STAGE.FREED_SERVILS],
    ['wants to kill me himself', FA_STAGE.DEFEATED_BOUNCER],
    ['ordered me to fight his pet', FA_STAGE.DEFEATED_SCORPION],
    ['going to have to fight in the arena', FA_STAGE.SENT_JAIL],
    ['should talk to jeremy in the fight arena', FA_STAGE.DEFEATED_OGRE],
    ['i need to protect jeremy and his father', FA_STAGE.ENTERED_OGRE_FIGHT],
    ['now i\'ve got the keys', FA_STAGE.GIVEN_KHALI_BREW],
    ['guards told me that he really likes', FA_STAGE.SPOKEN_DRUNKGUARD],
    ['luckily i found some khazard armour in a chest', FA_STAGE.OBTAINED_ARMOUR],
    ['and try to find her family', FA_STAGE.STARTED],
    ['i can start this quest by speaking to', FA_STAGE.NOT_STARTED]
];

export function parseFightArenaJournal(lines: readonly string[] | string): number | undefined {
    const text = normalizeJournal(lines);
    if (text.length === 0) {
        return undefined;
    }
    return NEEDLES.find(([needle]) => text.includes(needle))?.[1];
}

// Why: a read taken while something is swinging comes back empty, and standing still to re-read it is the one thing the arena punishes.
// Why: the stage only ever moves forward, so the last one read is a sound floor to act on until the next read lands.
let lastRead: number | undefined;

/** Forget the cached stage. Tests and a fresh account want a clean slate. */
export function resetFightArenaStage(): void {
    lastRead = undefined;
}

// Why: the journal body is built only when the player opens the quest, and it is a main modal that hides every later read until it is closed.

/** The stage, read from the quest list colour and the journal scroll. */
export async function readFightArenaStage(): Promise<number | undefined> {
    const status = Quests.status(FIGHT_ARENA_QUEST);
    if (status === 'complete') {
        lastRead = FA_STAGE.COMPLETE;
        return FA_STAGE.COMPLETE;
    }
    if (status === 'notStarted') {
        lastRead = FA_STAGE.NOT_STARTED;
        return FA_STAGE.NOT_STARTED;
    }
    if (status !== 'inProgress') {
        return lastRead;
    }
    const stage = parseFightArenaJournal(await Quests.journal(FIGHT_ARENA_QUEST));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    if (stage !== undefined) {
        lastRead = stage;
        return stage;
    }
    return lastRead;
}
