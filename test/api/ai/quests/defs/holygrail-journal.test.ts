import { describe, expect, test } from 'bun:test';

import { GRAIL_STAGE, parseHolyGrailJournal } from '#/bot/api/ai/quests/defs/holygrail/journal.js';

const NOT_STARTED =
    '@dbl@I can start this quest by speaking to @dre@King Arthur@dbl@ at|'
    + '@dre@Camelot Castle@dbl@, just @dre@North West of Catherby|'
    + '@dbl@To complete this quest I must be able to defeat a @dre@Level|@dre@120 Black Knight Titan@dbl@.|';

const STARTED =
    '@dre@King Arthur@dbl@ has sent me questing for the @dre@Holy Grail@dbl@ of|'
    + '@dbl@legend. I should start my quest by speaking to @dre@Merlin@dbl@ in @dre@his|'
    + '@dre@study next to the Camelot library@dbl@ for directions to it.';

const PREAMBLE =
    '@str@I started my Quest for the Holy Grail in Camelot Castle.|'
    + '@str@King Arthur sent me to Merlin for advice on locating it.|';

const MERLIN =
    PREAMBLE
    + '@dre@Merlin@dbl@ suggested two things to help find the @dre@Grail:|'
    + "@dbl@Speak to @dre@Galahad@dbl@ who lives @dre@West@dbl@ of @dre@McGrubor's Wood.|"
    + "@dbl@Talk to someone on a '@dre@Holy Island@dbl@' he can't remember.";

const CRONE =
    PREAMBLE
    + '@dbl@According to a Crone on @dre@Entrana@dbl@ I need to go to where the|'
    + "@dbl@'@dre@Six Heads' face@dbl@ and blow a @dre@magic whistle@dbl@ there.|"
    + '@dbl@To get the @dre@Magic Whistle@dbl@ I need to carry something from|'
    + '@dbl@the @dre@Realm of the Fisher King@dbl@ to a @dre@Haunted House@dbl@...';

const GALAHAD_BLOCK =
    '@str@I spoke to Galahad in his shack West of McGrubor\'s Wood.|'
    + '@str@Galahad gave me a napkin from the Realm of the Fisher|@str@King.|'
    + '@str@I used the napkin to find a holy whistle that could teleport|@str@me to the Realm of the Fisher King.|'
    + '@str@I blew the Whistle at the correct location and was|'
    + '@str@teleported to the Realm of the Fisher King. The path to|'
    + '@str@the Fisher King\'s castle was blocked by a mighty warrior|'
    + '@str@called the Black Knight Titan who seemed invincible!|';

const FAILED_TITAN = PREAMBLE + GALAHAD_BLOCK + '@dbl@I need to find a @dre@weapon@dbl@ that can defeat him somehow.';

const TITAN_BEATEN =
    PREAMBLE + GALAHAD_BLOCK
    + "@str@I defeated the Black Knight Titan with Excalibur's|"
    + '@str@power.Once past the Titan I entered the Grail Castle.|'
    + "@str@The Fisher King couldn't give me the Grail, but legends say|"
    + '@str@that the person who restores the land could claim the|@str@Grail.|';

const FINDING_PERCIVAL =
    TITAN_BEATEN
    + '@dbl@The @dre@Fisher King@dbl@ is very sick. He has asked me to find his|'
    + '@dbl@son @dre@Sir Percival@dbl@, a @dre@Knight of the Round Table.|';

const FINDING_PERCIVAL_WITH_FEATHER =
    FINDING_PERCIVAL
    + '@dre@King Arthur@dbl@ gave me a @dre@magic golden feather@dbl@ to help locate|'
    + '@dre@Sir Percival@dbl@ - I should use it to find him!';

const GIVEN_WHISTLE =
    TITAN_BEATEN
    + "@str@I honoured the Fisher King's request to find his son, and|"
    + '@str@used a Magic Golden Feather to track him down. When he|'
    + "@str@heard of his father's illness he rushed back to the Grail|"
    + '@str@Castle using a Magic Whistle that I gave him.|'
    + '@dbl@I should follow him to the @dre@Castle@dbl@ to get the @dre@Holy Grail@dbl@.';

const GRAIL_HELD =
    TITAN_BEATEN
    + "@str@I honoured the Fisher King's request to find his son, and|"
    + '@str@used a Magic Golden Feather to track him down. When he|'
    + "@str@heard of his father's illness he rushed back to the Grail|"
    + '@str@Castle using a Magic Whistle that I gave him.|'
    + '@dbl@Now I have the @dre@Grail@dbl@ with me. I should take it to @dre@Arthur@dbl@.';

const COMPLETE =
    PREAMBLE + GALAHAD_BLOCK
    + '@str@I returned to the Grail Castle to find that the land had|'
    + '@str@been renewed with Percival as the new King there. Out of|'
    + '@str@gratitude he allowed me to take the Grail, which I took to|'
    + '@str@King Arthur to prove my prowess as a Knight.||@red@QUEST COMPLETE!';

describe('Holy Grail journal', () => {
    test('empty text reads as unknown, not as not-started', () => {
        expect(parseHolyGrailJournal('')).toBeUndefined();
        expect(parseHolyGrailJournal([])).toBeUndefined();
    });

    test('text with no known needle reads as unknown', () => {
        expect(parseHolyGrailJournal('@str@Some other quest entirely.')).toBeUndefined();
    });

    const PAGES: readonly [string, string, number][] = [
        ['not started', NOT_STARTED, GRAIL_STAGE.NOT_STARTED],
        ['started', STARTED, GRAIL_STAGE.STARTED],
        ['spoken to Merlin', MERLIN, GRAIL_STAGE.SPOKEN_MERLIN],
        ['spoken to the Crone', CRONE, GRAIL_STAGE.SPOKEN_CRONE],
        ['failed the titan', FAILED_TITAN, GRAIL_STAGE.FAILED_TITAN],
        ['finding Percival', FINDING_PERCIVAL, GRAIL_STAGE.FINDING_PERCIVAL],
        ['finding Percival with the feather', FINDING_PERCIVAL_WITH_FEATHER, GRAIL_STAGE.FINDING_PERCIVAL],
        ['given the whistle', GIVEN_WHISTLE, GRAIL_STAGE.GIVEN_WHISTLE],
        ['carrying the Grail', GRAIL_HELD, GRAIL_STAGE.GIVEN_WHISTLE],
        ['complete', COMPLETE, GRAIL_STAGE.COMPLETE]
    ];

    for (const [label, text, stage] of PAGES) {
        test(label, () => {
            expect(parseHolyGrailJournal(text)?.stage).toBe(stage);
        });
    }

    test('the struck-through Galahad block never outranks a later stage', () => {
        expect(parseHolyGrailJournal(FINDING_PERCIVAL)?.stage).not.toBe(GRAIL_STAGE.FAILED_TITAN);
        expect(parseHolyGrailJournal(GIVEN_WHISTLE)?.stage).not.toBe(GRAIL_STAGE.SPOKEN_CRONE);
    });

    test('line arrays and one joined string read the same', () => {
        expect(parseHolyGrailJournal(CRONE.split('|'))?.stage).toBe(GRAIL_STAGE.SPOKEN_CRONE);
    });
});
