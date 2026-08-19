import { describe, expect, test } from 'bun:test';

import { FC_STAGE, parseFishingContestJournal } from '#/bot/api/ai/quests/defs/fishingcontest/journal.js';

const PREAMBLE =
    '@str@The Dwarves will let me use the tunnel through White Wolf|@str@Mountain if I can win the Hemenster Fishing Competition.|';

const PAGE: Record<number, string> = {
    [FC_STAGE.NOT_STARTED]:
        '@dbl@I can start this quest by speaking to the @dre@Dwarves@dbl@ at the tunnel entrances on either side of @dre@White Wolf Mountain@dbl@.|'
        + '@str@I must have level 10 fishing.',
    [FC_STAGE.STARTED]:
        PREAMBLE
        + '@dbl@They gave me a @dre@Fishing Contest Pass@dbl@ to enter the contest. I need to bring them back the @dre@Hemenster Fishing Trophy',
    [FC_STAGE.IN_COMP]:
        PREAMBLE
        + '@dbl@My @dre@fishing spot@dbl@ in the contest is @dre@next to the willow tree @dbl@I need to catch the @dre@biggest fish@dbl@ to win!',
    [FC_STAGE.GARLIC_COMP]:
        PREAMBLE
        + '@dbl@My @dre@fishing spot@dbl@ in the contest is @dre@next to the pipes @dbl@I need to catch the @dre@biggest fish@dbl@ to win!',
    [FC_STAGE.WON_COMP]:
        PREAMBLE
        + '@str@I easily won the contest by catching some Giant Carp.|'
        + '@dbl@I should take the @dre@Trophy@dbl@ back to the @dre@Dwarf@dbl@ at the side of @dre@White Wolf Mountain@dbl@ and claim my @dre@reward',
    [FC_STAGE.COMPLETE]:
        '@dbl@The Dwarves wanted me to earn their friendship by|@dbl@winning the Hemenster Fishing Competition.|'
        + '@dbl@I scared away a vampire with some garlic and easily won the contest by catching some Giant Carp.|'
        + '@dbl@As a reward for getting the Fishing Competition Trophy the Dwarves will let me use their tunnel to travel quickly and|'
        + '@dbl@safely under White Wolf Mountain anytime I wish.||@red@QUEST COMPLETE!'
};

describe('Fishing Contest journal parsing', () => {
    for (const [stage, page] of Object.entries(PAGE)) {
        test(`reads its own page as stage ${stage}`, () => {
            expect(parseFishingContestJournal(page)).toBe(Number(stage));
        });
    }

    test('separates the willow-tree spot from the pipes', () => {
        expect(parseFishingContestJournal(PAGE[FC_STAGE.IN_COMP]!)).toBe(FC_STAGE.IN_COMP);
        expect(parseFishingContestJournal(PAGE[FC_STAGE.GARLIC_COMP]!)).toBe(FC_STAGE.GARLIC_COMP);
    });

    test('reads the complete page even though it still mentions the garlic and the carp', () => {
        expect(parseFishingContestJournal(PAGE[FC_STAGE.COMPLETE]!)).toBe(FC_STAGE.COMPLETE);
    });

    test('accepts the page as an array of lines', () => {
        expect(parseFishingContestJournal(PAGE[FC_STAGE.WON_COMP]!.split('|'))).toBe(FC_STAGE.WON_COMP);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseFishingContestJournal('some other quest entirely')).toBeUndefined();
        expect(parseFishingContestJournal('')).toBeUndefined();
    });
});
