import { describe, expect, test } from 'bun:test';

import { CB_STAGE } from '#/bot/api/ai/quests/defs/chompybird/areas.js';
import { parseChompyJournal } from '#/bot/api/ai/quests/defs/chompybird/journal.js';

const NOT_STARTED = '@dbl@I can start this quest by speaking to the ogre @dre@Rantz @dbl@who|lives @dre@East '
    + '@dbl@of the @dre@Ogre City@dbl@, @dre@North @dbl@of the @dre@Swamp Pool.|@dbl@To complete this quest I need:|'
    + '@str@Level 5 Fletching|@str@Level 30 Cooking|@str@Level 30 Ranging|';

const OPENING = "@str@I found an ogre named Rantz near a cave just East of|@str@the Ogre City. When I spoke to him he seemed obsessed|@str@with using things called 'stabbers' to hunt 'Chompy Birds'.|";

const STARTED = "|@dbl@I agreed to get @dre@Rants @dbl@some @dre@'stabbers'";

const ARROWS = "|@str@It turned out that 'stabbers' are a kind of specially made|@str@ogre arrow that are quite sturdily constructed. I brought|@str@Rantz some so that he could catch 'chompy'.|";

const TOADIES = "|@str@Rantz told me 'fatsy toadies' grow fat on swamp gas...|";

const TRAPPED = "|@str@I managed to trap some 'fatsy toadies' by using some gas|@str@filled ogre bellows. I took the 'fatsy toady' to Rantz.|";

const DROPPED = '|@str@I dropped a fatsy toady on the spot Rantz showed me.|';

const MISSED = "|@str@Rantz doesn't seem to be a very good shot... maybe I|@str@should try to shoot a chompy for him?|";

const LENT = '|@dre@Rantz @dbl@has lent me an @dre@Ogre bow @dbl@so I can kill a @dre@chompy|bird.';

const KILLED = '|@str@Rantz taught me how to use bloated swamp toads to lure|@str@Chompy Birds and hunt them. '
    + "I've killed a chompy bird!|";

const SHOWN = '|@str@I showed Rantz the chompy. He seemed quite impressed.|';

const COOKED = "|@dbl@I've @dre@cooked @dbl@the @dre@chompy @dbl@for that cheeky @dre@ogre @dbl@and his @dre@kids@dbl@,|"
    + 'I\'d better take it to them before they @dre@starve@dbl@!';

const COMPLETE = "@str@Once I had Rantz's bow, it was easy to hunt chompy birds|@str@using the nearby swamp toads."
    + '|@red@QUEST COMPLETE!';

const stageOf = (page: string): number | undefined => parseChompyJournal(page)?.stage;

describe('big chompy bird hunting journal', () => {
    test('an unrecognised page parses to nothing', () => {
        expect(parseChompyJournal('nothing to do with ogres')).toBeUndefined();
    });

    test('the not-started page', () => {
        expect(stageOf(NOT_STARTED)).toBe(CB_STAGE.NOT_STARTED);
    });

    test('the completion page wins over every line above it', () => {
        expect(stageOf(OPENING + ARROWS + KILLED + COMPLETE)).toBe(CB_STAGE.COMPLETE);
    });

    test('agreeing to make the stabbers', () => {
        expect(stageOf(OPENING + STARTED)).toBe(CB_STAGE.STARTED);
    });

    test('the arrows handed over', () => {
        expect(stageOf(OPENING + ARROWS)).toBe(CB_STAGE.GIVEN_ARROWS);
    });

    test('the toadies explained', () => {
        expect(stageOf(OPENING + ARROWS + TOADIES)).toBe(CB_STAGE.KIDS_PLAY_WITH_TOAD);
    });

    test('a toad shown to Rantz', () => {
        expect(stageOf(OPENING + ARROWS + TOADIES + TRAPPED)).toBe(CB_STAGE.SHOWN_TOAD);
    });

    test('the bait placed', () => {
        expect(stageOf(OPENING + ARROWS + TOADIES + TRAPPED + DROPPED)).toBe(CB_STAGE.DROPPED_TOAD);
    });

    // Why: 40 and 45 render the same paragraph, and only the lent-bow line separates them.
    test('Rantz missing his shot', () => {
        expect(stageOf(OPENING + ARROWS + TOADIES + TRAPPED + DROPPED + MISSED)).toBe(CB_STAGE.RANTZ_MISSED);
    });

    test('the bow lent out', () => {
        expect(stageOf(OPENING + ARROWS + TOADIES + TRAPPED + DROPPED + MISSED + LENT)).toBe(CB_STAGE.GOT_BOW);
    });

    test('the chompy killed', () => {
        expect(stageOf(OPENING + ARROWS + TOADIES + TRAPPED + DROPPED + MISSED + KILLED)).toBe(CB_STAGE.KILLED_CHOMPY);
    });

    test('the carcass shown to Rantz', () => {
        expect(stageOf(OPENING + ARROWS + DROPPED + MISSED + KILLED + SHOWN)).toBe(CB_STAGE.TOLD_TO_COOK);
    });

    test('the chompy cooked', () => {
        expect(stageOf(OPENING + ARROWS + DROPPED + MISSED + KILLED + SHOWN + COOKED)).toBe(CB_STAGE.CHOMPY_COOKED);
    });

    test('a page split into components reads the same as one string', () => {
        expect(parseChompyJournal([OPENING, ARROWS, TOADIES])?.stage).toBe(CB_STAGE.KIDS_PLAY_WITH_TOAD);
    });
});
