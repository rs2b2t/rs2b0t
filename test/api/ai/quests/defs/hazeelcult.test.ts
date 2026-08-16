import { describe, expect, test } from 'bun:test';

import { ARMOUR_OBJ, HC_STAGE, atCaveMouth, decide, hazeelcult, inHideout, parseHazeelJournal } from '#/bot/api/ai/quests/defs/hazeelcult.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const NOT_STARTED =
    '@dbl@I can start this quest by talking to @dre@Sir Ceril Carnillean@dbl@ at the house due @dre@West@dbl@ of @dre@Ardougne Zoo';

const PREAMBLE =
    '@str@I spoke to Sir Ceril Carnillean at his house, and|@str@agreed to help him investigate the theft of a|@str@family heirloom.';

const STARTED = PREAMBLE
    + '|@dbl@The @dre@Cult@dbl@ who were responsible live in a cave @dre@South@dbl@ of the|'
    + '@dre@Carnillean Mansion near the start of the forest|';

const FOUND_CLIVET = PREAMBLE
    + "|@str@I found a member of the cult called Clivet at the entrance|@str@to the cult's hideout, south of Ardougne.|";

const SPOKEN_CLIVET = FOUND_CLIVET
    + '@dbl@He told me a pack of lies about the Carnilleans, then asked me to join the cult. Obviously, I refused.|'
    + 'I was still no closer to recovering the @dre@missing armour';

const REFUSED_LINES = '@str@He told me a pack of lies about the Carnilleans, then asked|'
    + '@str@me to join the cult. Obviously, I refused.|'
    + '@str@I was still no closer to recovering the missing armour|';

const REFUSED_CULT = FOUND_CLIVET + REFUSED_LINES
    + '@dbl@After speaking to him, he jumped onto a @dre@raft@dbl@ and headed into the @dre@sewer system@dbl@. I need to find a way to follow.';

const KILLED_LINES = '@str@I managed to enter the hideout, kill the cult leader and|'
    + '@str@retrieve the armour. I discovered that Jones the Butler|'
    + '@str@was secretly a member of the cult and a traitor.|';

const KILLED_ALOMONE = FOUND_CLIVET + REFUSED_LINES + KILLED_LINES
    + "@dbl@I should return @dre@Ceril's armour@dbl@ and tell him about @dre@Jones";

const RETURNED_LINES = "@str@I returned the armour, but Ceril didn't believe Jones was|"
    + '@str@involved with the cult and was responsible for the theft.|';

const RETURNED_ARMOUR = FOUND_CLIVET + REFUSED_LINES + KILLED_LINES + RETURNED_LINES
    + '@dbl@I have to find some @dre@evidence@dbl@ linking @dre@Butler Jones@dbl@ to the @dre@Cult@dbl@ so that I can @dre@clear my name@dbl@ and claim my @dre@reward';

const COMPLETE = FOUND_CLIVET + REFUSED_LINES + KILLED_LINES + RETURNED_LINES
    + '@str@I found undeniable evidence that the Butler was involved|'
    + '@str@with the cult and gave it to Ceril. My name was cleared|'
    + '@str@and I graciously accepted the reward for all of my help.|||@red@QUEST COMPLETE!';

const EVIL_JOINED = FOUND_CLIVET
    + "@dre@Clivet@dbl@ told me the truth about the @dre@Carnilleans@dbl@, and I decided I would help them in their revenge. He gave me some @dre@poison@dbl@ to put into the @dre@family's food";

const EVIL_POISONED = FOUND_CLIVET
    + '@str@Having decided to assist the cult in their mission|@str@to revive Hazeel, I have poisoned some food to|@str@try and poison the Carnilleans.|'
    + '@str@I spoke to Clivet and he told me that I had failed, but he|@str@gave me an amulet anyway.|'
    + '@dbl@By turning the @dre@sewer valves@dbl@ in the directions shown by the @dre@amulet@dbl@, I can take the @dre@sewer raft@dbl@ to the hideout';

const EVIL_BRIEFED = FOUND_CLIVET
    + '@str@Having decided to assist the cult in their mission|@str@to revive Hazeel, I have poisoned some food to|@str@try and poison the Carnilleans.|'
    + '@str@I spoke to Clivet and he told me that I had failed, but he|@str@gave me an amulet anyway.|'
    + '@str@Then I managed to take the sewer rafts to the cult hideout.|'
    + '@dre@Alomone@dbl@ told me to find a @dre@spell scroll@dbl@ that is hidden somewhere within the @dre@Carnillean household|';

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    evil?: boolean;
    invIds?: number[];
    wornIds?: number[];
    bankIds?: number[];
    bankKnown?: boolean;
    progress?: QuestProgress | undefined;
}

function idCounts(ids: number[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const id of ids) {
        result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const progress = 'progress' in options
        ? options.progress
        : { stage: options.stage ?? HC_STAGE.STARTED, flags: new Set(options.evil ? ['evil'] : []) };
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: new Map(),
        bankIds: idCounts(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Hazeel Cult journal parsing', () => {
    test('reads the not-started page', () => {
        expect(parseHazeelJournal(NOT_STARTED)?.stage).toBe(HC_STAGE.NOT_STARTED);
    });

    test('reads the page that only points at the forest cave', () => {
        expect(parseHazeelJournal(STARTED)?.stage).toBe(HC_STAGE.STARTED);
    });

    test('separates a first word with Clivet from the refusal that follows it', () => {
        expect(parseHazeelJournal(SPOKEN_CLIVET)?.stage).toBe(HC_STAGE.SPOKEN_CLIVET);
        expect(parseHazeelJournal(REFUSED_CULT)?.stage).toBe(HC_STAGE.REFUSED_CULT);
    });

    test('reads the kill and the hand-over apart, though the page keeps both', () => {
        expect(parseHazeelJournal(KILLED_ALOMONE)?.stage).toBe(HC_STAGE.KILLED_ALOMONE);
        expect(parseHazeelJournal(RETURNED_ARMOUR)?.stage).toBe(HC_STAGE.RETURNED_ARMOUR);
    });

    test('reads the finished page as complete', () => {
        expect(parseHazeelJournal(COMPLETE)?.stage).toBe(HC_STAGE.COMPLETE);
    });

    test('flags every cult-side page, so no leg mistakes one for the Carnillean side', () => {
        for (const page of [EVIL_JOINED, EVIL_POISONED, EVIL_BRIEFED]) {
            expect(parseHazeelJournal(page)?.flags.has('evil')).toBe(true);
        }
    });

    test('leaves no Carnillean-side page flagged as the cult side', () => {
        for (const page of [STARTED, SPOKEN_CLIVET, REFUSED_CULT, KILLED_ALOMONE, RETURNED_ARMOUR]) {
            expect(parseHazeelJournal(page)?.flags.has('evil')).toBe(false);
        }
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseHazeelJournal('some other quest entirely')).toBeUndefined();
    });
});

describe('Hazeel Cult decide', () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('opens with Ceril when the quest has not started', () => {
        expect(customName(decide(snap({ stage: HC_STAGE.NOT_STARTED })))).toBe('ask Ceril Carnillean about the stolen armour');
    });

    test('refuses Clivet from either of the two stages that offer the choice', () => {
        for (const stage of [HC_STAGE.STARTED, HC_STAGE.SPOKEN_CLIVET]) {
            expect(customName(decide(snap({ stage })))).toBe('refuse Clivet at the cult cave');
        }
    });

    test('goes for the armour once the side is locked in', () => {
        expect(customName(decide(snap({ stage: HC_STAGE.REFUSED_CULT })))).toBe('take the Carnillean armour from the cult hideout');
    });

    test('returns the armour it is carrying rather than riding back in', () => {
        expect(customName(decide(snap({ stage: HC_STAGE.KILLED_ALOMONE, invIds: [ARMOUR_OBJ] }))))
            .toBe('return the armour to Ceril upstairs');
    });

    test('counts a worn suit as carried', () => {
        expect(customName(decide(snap({ stage: HC_STAGE.KILLED_ALOMONE, wornIds: [ARMOUR_OBJ] }))))
            .toBe('return the armour to Ceril upstairs');
    });

    test('reads the bank before believing the armour is gone', () => {
        expect(decide(snap({ stage: HC_STAGE.KILLED_ALOMONE, bankKnown: false })).kind).toBe('scanBank');
    });

    test('withdraws a banked suit, since a banked copy stops Alomone dropping another', () => {
        const step = decide(snap({ stage: HC_STAGE.KILLED_ALOMONE, bankIds: [ARMOUR_OBJ] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].id).toBe(ARMOUR_OBJ);
    });

    test('rides back in when the armour is nowhere', () => {
        expect(customName(decide(snap({ stage: HC_STAGE.KILLED_ALOMONE }))))
            .toBe('take the Carnillean armour from the cult hideout');
    });

    test('searches the cupboard once the armour is handed over', () => {
        expect(customName(decide(snap({ stage: HC_STAGE.RETURNED_ARMOUR })))).toBe("search Jones' cupboard for the evidence");
    });

    test('stops rather than guessing on a save that joined the cult', () => {
        const step = decide(snap({ stage: HC_STAGE.POURED_POISON, evil: true }));

        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('joined the cult');
    });
});

describe('Hazeel Cult areas', () => {
    test('the hideout box holds the raft landing and Alomone but no sewer island', () => {
        expect(inHideout({ x: 2606, z: 9692 })).toBe(true);
        expect(inHideout({ x: 2609, z: 9669 })).toBe(true);
        for (const island of [{ x: 2578, z: 9687 }, { x: 2593, z: 9694 }, { x: 2599, z: 9712 }, { x: 2616, z: 9725 }]) {
            expect(inHideout(island)).toBe(false);
        }
    });

    test('the cave mouth box excludes the mansion cellar, which shares the mapsquare', () => {
        expect(atCaveMouth({ x: 2570, z: 9682 })).toBe(true);
        expect(atCaveMouth({ x: 2567, z: 9680 })).toBe(true);
        expect(atCaveMouth({ x: 2570, z: 9668 })).toBe(false);
        expect(atCaveMouth({ x: 2578, z: 9687 })).toBe(false);
    });

    test('neither box claims a tile above ground', () => {
        expect(inHideout({ x: 2606, z: 3292 })).toBe(false);
        expect(atCaveMouth({ x: 2570, z: 3282 })).toBe(false);
    });
});

describe('Hazeel Cult module', () => {
    test('names only the two crossings the walker may pick for itself', () => {
        const stands = (hazeelcult.hops ?? []).map(h => `${h.stand.x},${h.stand.z}`);

        expect(stands.sort()).toEqual(['2570,9682', '2585,3233']);
    });

    test('keeps the armour off the deposit list', () => {
        expect(hazeelcult.tools).toContain('carnillean armour');
    });

    test('declares no items, so a resume mid-quest fetches nothing it cannot buy', () => {
        expect(hazeelcult.record.items).toEqual([]);
    });

    test('runs after Plague City, whose teleport pays for the Ardougne legs', () => {
        const order = QUEST_DEFS.map(d => d.record.id);

        expect(order.indexOf('hazeelcult')).toBeGreaterThan(order.indexOf('elena'));
    });
});
