import { describe, expect, test } from 'bun:test';

import { EC_STAGE } from '#/bot/api/ai/quests/defs/ernest/areas.js';
import { parseErnestJournal } from '#/bot/api/ai/quests/defs/ernest/journal.js';

/** Verbatim from content/scripts/quests/quest_haunted/scripts/haunted_journal.rs2. */
const NOT_STARTED = '@dbl@I can start this quest by speaking to @dre@Veronica@dbl@ who is outside @dre@Draynor Manor||@dbl@There aren\'t any requirements for this quest';
const STARTED = '@str@I have spoken to Veronica||@dbl@I need to find @dre@Ernest|@dbl@He went into @dre@Draynor Manor@dbl@ and hasn\'t returned';
const SPOKEN = '@str@I have spoken to Veronica||@str@I\'ve spoken to Dr Oddenstein, and discovered Ernest is a|@str@chicken||@dbl@I need to bring @dre@Dr Oddenstein@dbl@ parts for his machine|@dre@1 Oil Can|@dre@1 Pressure Gauge|@dre@1 Rubber Tube';
const COMPLETE = '@str@I have spoken to Veronica||@str@I have collected all the parts for the machine||@str@Dr Oddenstein thanked me for helping fix his machine|@str@We turned Ernest back to normal and he rewarded me|@red@QUEST COMPLETE!';

describe('Ernest the Chicken journal', () => {
    test('reads every stage the engine can render', () => {
        expect(parseErnestJournal(NOT_STARTED)?.stage).toBe(EC_STAGE.NOT_STARTED);
        expect(parseErnestJournal(STARTED)?.stage).toBe(EC_STAGE.STARTED);
        expect(parseErnestJournal(SPOKEN)?.stage).toBe(EC_STAGE.SPOKEN_ODDENSTEIN);
        expect(parseErnestJournal(COMPLETE)?.stage).toBe(EC_STAGE.COMPLETE);
    });

    test('accepts the line array the client actually hands over', () => {
        expect(parseErnestJournal(SPOKEN.split('|'))?.stage).toBe(EC_STAGE.SPOKEN_ODDENSTEIN);
    });

    test('the stage-2 needle survives the parts checklist flipping to green', () => {
        // Held parts recolour @dre@ to @str@; the needle must not sit on one.
        const allHeld = SPOKEN.replace(/@dre@/g, '@str@');
        expect(parseErnestJournal(allHeld)?.stage).toBe(EC_STAGE.SPOKEN_ODDENSTEIN);
    });

    test('returns undefined for text from another quest', () => {
        expect(parseErnestJournal('@dbl@I can start this quest by talking to the @dre@Squire')).toBeUndefined();
    });
});
