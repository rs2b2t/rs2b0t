import { describe, expect, test } from 'bun:test';

import { KS_STAGE } from '#/bot/api/ai/quests/defs/knightssword/areas.js';
import { parseKnightsSwordJournal } from '#/bot/api/ai/quests/defs/knightssword/journal.js';

// Verbatim from scripts/quests/quest_squire/scripts/squire_journal.rs2.
const HELPED = '@str@I told the Squire I would help him to replace the sword he had|'
    + '@str@lost. It could only be made by an Imcando dwarf.|';
const FOUND_THURGO = '@str@I found an Imcando dwarf named Thurgo thanks to|'
    + "@str@information provided by Reldo. He wasn't very talkative|"
    + '@str@until I gave him a Redberry pie, which he gobbled up.|';
const TOOK_PORTRAIT = '@str@Turgo needed a picture of the sword before he could start|'
    + '@str@work on a replacement. I took him a portrait of it.|';

const NOT_STARTED = '@dbl@I can start this quest by talking to the @dre@Squire @dbl@in the|'
    + "@dbl@courtyard of the @dre@White Knights' Castle@dbl@.|"
    + '@str@I have a mining level of 10|'
    + '@dbl@I would have an advantage if I had a combat level of @dre@20.';

const STARTED = HELPED
    + '@dbl@The Squire suggests I speak to @dre@Reldo @dbl@in the @dre@Varrock Palace|'
    + '@dre@Library @dbl@for information about the @dre@Imcando Dwarves.';

const SPOKEN_RELDO = HELPED
    + "@dbl@Reldo couldn't give me much information about the @dre@Imcando|"
    + '@dbl@except a few live on the @dre@southern peninsula of Asgarnia,|'
    + '@dbl@they dislike strangers, and LOVE @dre@redberry pies.';

const GIVEN_PIE = HELPED + FOUND_THURGO
    + '@dbl@He will help me now I have gained his trust through @dre@pie.';

const SPOKEN_THURGO = HELPED + FOUND_THURGO
    + '@dre@Thurgo @dbl@needs a @dre@picture of the sword @dbl@before he can help.|'
    + '@dbl@I should probably ask the @dre@Squire @dbl@about obtaining one.';

const LOOKING_PORTRAIT = HELPED + FOUND_THURGO
    + '@str@Turgo needed a picture of the sword to replace.|'
    + "@dbl@The Squire told me about a @dre@portrait @dbl@of Sir Vyvin's father|"
    + "@dbl@which has a @dre@picture of the sword @dbl@in @dre@Sir Vyvin's room.|";

const NEEDS_MATERIALS = HELPED + FOUND_THURGO + TOOK_PORTRAIT
    + '@dbl@According to @dre@Thurgo @dbl@to make a @dre@replica sword @dbl@he will need @dre@two|'
    + '@dre@Iron Bars @dbl@and some @dre@Blurite Ore@dbl@. @dre@Blurite Ore @dbl@can only be|'
    + "@dbl@found @dre@deep in the caves below Thurgo's house@dbl@. I should|"
    + '@dbl@prepare myself to fend off Ice giants.';

const SWORD_MADE = HELPED + FOUND_THURGO + TOOK_PORTRAIT
    + "@str@Thurgo has now smithed me a replica of Sir Vyvin's sword.|"
    + '@dbl@I should return it to the @dre@Squire @dbl@for my @dre@reward.';

const COMPLETE = HELPED + FOUND_THURGO + TOOK_PORTRAIT
    + '@str@After bringing Thurgo two iron bars and some blurite ore|'
    + "@str@he made me a fine replica of Sir Vyvin's sword, which I|"
    + '@str@returned to the Squire for a reward.||'
    + '@red@QUEST COMPLETE!';

describe("The Knight's Sword journal", () => {
    const cases: [string, string, number][] = [
        ['not started', NOT_STARTED, KS_STAGE.NOT_STARTED],
        ['started', STARTED, KS_STAGE.STARTED],
        ['spoken to Reldo', SPOKEN_RELDO, KS_STAGE.SPOKEN_RELDO],
        ['given the pie', GIVEN_PIE, KS_STAGE.GIVEN_PIE],
        ['spoken to Thurgo', SPOKEN_THURGO, KS_STAGE.SPOKEN_THURGO],
        ['looking for the portrait', LOOKING_PORTRAIT, KS_STAGE.LOOKING_PORTRAIT],
        ['needing materials', NEEDS_MATERIALS, KS_STAGE.LOOKING_BLURITE],
        ['holding the finished sword', SWORD_MADE, KS_STAGE.LOOKING_BLURITE],
        ['complete', COMPLETE, KS_STAGE.COMPLETE]
    ];

    for (const [label, text, stage] of cases) {
        test(`reads ${label}`, () => {
            expect(parseKnightsSwordJournal(text)?.stage).toBe(stage);
        });
    }

    test('an unrecognised scroll reads as undefined', () => {
        expect(parseKnightsSwordJournal('@dbl@Some other quest entirely.')).toBeUndefined();
    });

    test('accepts an array of lines', () => {
        expect(parseKnightsSwordJournal(SWORD_MADE.split('|'))?.stage).toBe(KS_STAGE.LOOKING_BLURITE);
    });

    test('the appended prefix never outranks the newest marker', () => {
        // Why: stages from 3 on keep the "found an Imcando dwarf" line and stages from 1 on keep "I told the Squire", so a needle matching either pins the quest at its earliest stage.
        for (const [, text, stage] of cases.filter(([, , s]) => s >= KS_STAGE.GIVEN_PIE)) {
            expect(parseKnightsSwordJournal(text)?.stage).toBeGreaterThanOrEqual(KS_STAGE.GIVEN_PIE);
            expect(parseKnightsSwordJournal(text)?.stage).toBe(stage);
        }
    });
});
