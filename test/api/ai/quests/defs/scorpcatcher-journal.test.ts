import { describe, expect, test } from 'bun:test';

import { SC_STAGE } from '#/bot/api/ai/quests/defs/scorpcatcher/areas.js';
import { parseScorpionJournal } from '#/bot/api/ai/quests/defs/scorpcatcher/journal.js';

const NOT_STARTED =
    "@dbl@I can start this quest by speaking to @dre@Thormac@dbl@ who is in the @dre@Sorcerer's Tower@dbl@"
    + ' south-west of @dre@Catherby@dbl@.||@dbl@Requirements:|@str@Level 31 Prayer|';

const PREAMBLE =
    "@str@I've spoken to Thormac in the Sorcerer's Tower south-west|"
    + "@str@of Catherby. He's lost his pet Kharid Scorpions and needs|"
    + '@str@my help to find them.';

const SEER_NEXT =
    "||@dbl@I need to go to the @dre@Seers' Village@dbl@ and talk to the @dre@Seers@dbl@"
    + ' about the lost @dre@Kharid Scorpions@dbl@.';

const SEEN_A_SEER =
    "||@str@I've spoken to a Seer and been given the location of one|@str@of the Kharid Scorpions.";

const FIRST_HINT =
    '||@dbl@The first @dre@Kharid Scorpion@dbl@ is in a secret room near some @dre@nasty spiders@dbl@'
    + ' with two @dre@coffins@dbl@ nearby.';

const CATCH_THE_FIRST =
    "||@dbl@I'll need to talk to a @dre@Seer@dbl@ again once I've caught the first @dre@Kharid Scorpion@dbl@.";

const SECOND_HINT =
    '||@dbl@The second @dre@Kharid Scorpion@dbl@ has been in a @dre@village of uncivilised-looking warriors'
    + " in the east@dbl@. It's been picked up by some sort of @dre@merchant@dbl@.";

const THIRD_HINT =
    '||@dbl@The third @dre@Kharid Scorpion@dbl@ is in some sort of @dre@upstairs room@dbl@'
    + ' with @dre@brown clothing@dbl@ on a table.';

const COMPLETE =
    "||@str@I've spoken to Thormac and he thanked me for finding his|@str@pet Kharid Scorpions."
    + '||@red@QUEST COMPLETE!';

describe('parseScorpionJournal', () => {
    test('the unstarted page reads stage 0', () => {
        expect(parseScorpionJournal(NOT_STARTED)?.stage).toBe(SC_STAGE.NOT_STARTED);
    });

    test('Thormac spoken to but no Seer yet reads stage 1', () => {
        expect(parseScorpionJournal(PREAMBLE + SEER_NEXT)?.stage).toBe(SC_STAGE.STARTED);
    });

    test('the first hint alone reads stage 2', () => {
        const page = PREAMBLE + SEEN_A_SEER + FIRST_HINT + CATCH_THE_FIRST;
        expect(parseScorpionJournal(page)?.stage).toBe(SC_STAGE.FIRST_HINT);
    });

    // Why: the second and third hints arrive together, and the page keeps the first, so a rule that stops at the first hint would read every later stage as 2.
    test('the second hint reads stage 3 even with the first hint still on the page', () => {
        const page = PREAMBLE + SEEN_A_SEER + FIRST_HINT + SECOND_HINT + THIRD_HINT;
        expect(parseScorpionJournal(page)?.stage).toBe(SC_STAGE.SECOND_HINT);
    });

    test('the reward line reads complete', () => {
        const page = PREAMBLE + SEEN_A_SEER + FIRST_HINT + SECOND_HINT + THIRD_HINT + COMPLETE;
        expect(parseScorpionJournal(page)?.stage).toBe(SC_STAGE.COMPLETE);
    });

    test('lines arrive as an array as well as a string', () => {
        expect(parseScorpionJournal([PREAMBLE, SEER_NEXT])?.stage).toBe(SC_STAGE.STARTED);
    });

    test('a page from another quest parses to nothing', () => {
        expect(parseScorpionJournal('@dbl@I can start this quest by talking to @dre@Brother Kojo')).toBeUndefined();
    });
});
