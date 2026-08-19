import { describe, expect, test } from 'bun:test';

import { OBS_STAGE } from '#/bot/api/ai/quests/defs/observatory/areas.js';
import { parseObservatoryJournal } from '#/bot/api/ai/quests/defs/observatory/journal.js';

/** Verbatim from `itgronigen_journal.rs2`, which appends rather than replaces. */
const HEAD_DBL =
    '@dbl@I can start this quest by talking to the @dre@professor@dbl@, in the '
    + '@dre@Observatory reception, south-west of Ardougne.';

const HEAD =
    '@str@I can start this quest by talking to the professor, in the|'
    + '@str@Observatory reception, south-west of Ardougne.|';

const LIST_DBL =
    '@dbl@Seems the observatory telescope needs repairing, due to the nearby goblins. '
    + 'The @dre@professor@dbl@ wants me to help by getting the following, with the help of his @dre@assistant:||';

const LIST_STR =
    '@str@Seems the observatory telescope needs repairing, due to|'
    + '@str@the nearby goblins. The professor wants me to help by|'
    + '@str@getting the following, with the help of his assistant:||'
    + '@str@3 wooden planks|@str@1 bronze bar|@str@1 molten glass|@str@1 lens mould|';

const LENS_DBL =
    '@dbl@The @dre@professor@dbl@ was pleased to have all the pieces needed to fix the telescope. Apparently, '
    + 'the professor\'s last attempt at Crafting ended in disaster. So, he wants me to create the @dre@lens@dbl@ '
    + 'by using the @dre@molten glass@dbl@ with the @dre@mould.|Fine by me!|';

const LENS_STR =
    '@str@The professor was pleased to have all the pieces needed|'
    + '@str@to fix the telescope. Apparently, the professor\'s last|'
    + '@str@attempt at Crafting ended in disaster. So, he wants me to|'
    + '@str@create the lens by using the molten glass with the mould.|'
    + '@str@Fine by me!|';

const TELE_DBL =
    '@dbl@The @dre@professor@dbl@ has gone ahead to the @dre@Observatory.@dbl@ He wants me to meet him there '
    + 'by travelling through the @dre@dungeon@dbl@ below it.|';

const TELE_STR =
    '@str@The professor has eagerly gone ahead to the Observatory.|'
    + '@str@He wants me to meet him there by travelling through the|'
    + '@str@dungeon below it. I hope I get to look through the|'
    + '@str@telescope!|';

const WANTED = ['3 wooden planks', '1 bronze bar', '1 molten glass', '1 lens mould'];

/** Stages 1-4 list every item won so far in `@str@` and the one still wanted in `@dre@`. */
function shopping(index: number): string {
    return HEAD + LIST_DBL
        + WANTED.slice(0, index).map(w => `@str@${w}|`).join('')
        + `@dre@${WANTED[index]}|`;
}

const PAGES: Record<number, string> = {
    [OBS_STAGE.NOT_STARTED]: HEAD_DBL,
    [OBS_STAGE.STARTED]: shopping(0),
    [OBS_STAGE.GIVEN_PLANKS]: shopping(1),
    [OBS_STAGE.GIVEN_BRONZE]: shopping(2),
    [OBS_STAGE.GIVEN_GLASS]: shopping(3),
    [OBS_STAGE.GIVEN_MOULD]: HEAD + LIST_STR + LENS_DBL,
    [OBS_STAGE.SENT_TELESCOPE]: HEAD + LIST_STR + LENS_STR + TELE_DBL,
    [OBS_STAGE.COMPLETE]: HEAD + LIST_STR + LENS_STR + TELE_STR + '@dre@QUEST COMPLETE!'
        + '|@dbl@I should probably see what the @dre@assistant@dbl@ thinks of all this.|He should be pleased.'
};

describe('parseObservatoryJournal', () => {
    for (const [stage, page] of Object.entries(PAGES)) {
        test(`reads stage ${stage}`, () => {
            expect(parseObservatoryJournal(page)).toBe(Number(stage));
        });
    }

    test('reads a page handed over as separate lines', () => {
        expect(parseObservatoryJournal([HEAD, LIST_DBL, '@dre@3 wooden planks|'])).toBe(OBS_STAGE.STARTED);
    });

    test('the claimed-wine page still reads complete', () => {
        const wine = PAGES[OBS_STAGE.COMPLETE].replace('@dbl@I should probably', '@str@I had a word with')
            + '@str@some wine! What a pleasant chap.';
        expect(parseObservatoryJournal(wine)).toBe(OBS_STAGE.COMPLETE);
    });

    test('an unrelated page reads as unknown', () => {
        expect(parseObservatoryJournal('@dbl@I can start this by talking to Duke Horacio.')).toBeUndefined();
    });

    test('an empty page reads as unknown', () => {
        expect(parseObservatoryJournal([])).toBeUndefined();
    });
});
