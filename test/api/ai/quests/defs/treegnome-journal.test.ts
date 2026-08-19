import { describe, expect, test } from 'bun:test';

import { TG_STAGE, parseTreeGnomeJournal } from '#/bot/api/ai/quests/defs/treegnome/journal.js';

const NOT_STARTED =
    '@dbl@I can start this quest by speaking to @dre@Bolren@dbl@ at the center of the @dre@Tree Gnome maze@dbl@, West of @dre@Port Khazard'
    + '||@dbl@I need to be able to defeat a @dre@level 112 Warlord';

const OPENING =
    '@str@I spoke to King Bolren who told me that one of their orbs of|@str@protection has been stolen by Khazard troops.';

const MONTAI =
    '||@str@I spoke to Montai. The orb was in the Khazard stronghold|@str@North of the battlefield, but it was secure in there.';

const LOGS = '||@str@I brought Montai logs to help fortify their defences.';

const BALLISTA_READY =
    '|@str@Now their defences were secure, they were ready to use the|@str@Gnome Ballista to break through the enemy defences.';

const TRACKERS =
    '||@str@I found the three trackers and used their coordinates to fire|@str@the ballista straight into the Khazard stronghold.';

const BREACHED =
    '|@str@With the stronghold breached by ballista fire, I was able to|@str@make my way inside and recover the orb of protection.';

const FIRST_ORB =
    '||@str@I returned the orb to King Bolren, but while I was busy getting|@str@it the Khazard troops invaded the village and stole the|@str@remaining two orbs before heading north.';

const WARLORD =
    '||@str@After a fierce battle I defeated the warlord who\'d stolen|@str@the orbs, and reclaimed them for the gnome people.';

const REWARDED =
    '||@str@I returned them to King Bolren, and was rewarded for all|@str@of my help to the Gnome people in recovering the orbs.';

const COMPLETE = '||@red@QUEST COMPLETE!';

function page(...parts: string[]): string {
    return parts.join('');
}

describe('Tree Gnome Village journal parsing', () => {
    test('reads the unopened page as not started', () => {
        expect(parseTreeGnomeJournal(NOT_STARTED)?.stage).toBe(TG_STAGE.NOT_STARTED);
    });

    test('reads the opening page as started', () => {
        expect(parseTreeGnomeJournal(page(OPENING, '||@dbl@Commander Montai@dbl@, @dre@North@dbl@ of the maze, can help me get it'))?.stage)
            .toBe(TG_STAGE.STARTED);
    });

    test('reads Montai asking for wood as spoken to Montai', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, '||@dbl@I need to bring Montai @dre@logs'))?.stage)
            .toBe(TG_STAGE.SPOKEN_MONTAI);
    });

    test('reads the handed-over logs as the logs stage', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, '|@dbl@I should speak to @dre@Montai@dbl@ again'))?.stage)
            .toBe(TG_STAGE.GAVE_LOGS);
    });

    test('reads the ballista briefing as the tracker stage', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, BALLISTA_READY, '||@dbl@I need to head into the @dre@Battlefield'))?.stage)
            .toBe(TG_STAGE.FINDING_TRACKERS);
    });

    test('reads the fired ballista as the breach stage', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, BALLISTA_READY, TRACKERS, '|@dbl@With the @dre@Khazard stronghold@dbl@ exposed'))?.stage)
            .toBe(TG_STAGE.BALLISTA_FIRED);
    });

    test('reads the recovered orb as the return stage', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, BALLISTA_READY, TRACKERS, BREACHED, '||@dbl@I should return the @dre@orb'))?.stage)
            .toBe(TG_STAGE.RETRIEVED_ORB);
    });

    test('reads the raided village as the warlord hunt', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, BALLISTA_READY, TRACKERS, BREACHED, FIRST_ORB, '||@dbl@I should retrieve the @dre@two remaining orbs'))?.stage)
            .toBe(TG_STAGE.RETURNED_FIRST_ORB);
    });

    test('reads the dead warlord as the hand-back stage', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, BALLISTA_READY, TRACKERS, BREACHED, FIRST_ORB, WARLORD, '||@dbl@I should return them now'))?.stage)
            .toBe(TG_STAGE.DEFEATED_WARLORD);
    });

    test('reads the finished page as complete', () => {
        expect(parseTreeGnomeJournal(page(OPENING, MONTAI, LOGS, BALLISTA_READY, TRACKERS, BREACHED, FIRST_ORB, WARLORD, REWARDED, COMPLETE))?.stage)
            .toBe(TG_STAGE.COMPLETE);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseTreeGnomeJournal('some other quest entirely')).toBeUndefined();
    });
});
