import { describe, expect, test } from 'bun:test';
import { UP_FLAG, UP_STAGE, parseUpassJournal } from '#/bot/api/ai/quests/defs/upass/journal.js';

// Why: lines are verbatim from `upass_journal.rs2`, so the parser is tested against what the engine renders.
// Why: the journal is additive — every stage keeps the earlier lines — so each case builds on the last.
const KOFTIK_DONE = '@str@King Lathas asked me to meet a tracker named Koftik. He|@str@can be found by a cave entrance in far West Ardougne.|';
const MET_KOFTIK = '|@str@I have met Koftik. He fears these caves, but he agreed to|@str@help. He said to meet him at the bridge inside the cave.|';
const AT_BRIDGE = '|@str@I have met Koftik at an underground river where there is a|@str@drawbridge. But it\'s held up by ropes and pulleys. Koftik|@str@found a damp cloth amongst the charred remains of some|@str@arrows.|';
const CROSSED = '|@str@I managed to cross the bridge by shooting the stay rope|@str@with a burning arrow. I guess the only way now is onwards.|';
const ORBS = '|@str@After destroying four orbs I was able to climb down a well.|';
const WATCHED = '@str@Something is watching me, I\'m starting to understand|@str@Koftik\'s fear.|';
const SECOND_WELL = '|@str@I have found yet another well. Upon it an inscription says|@str@that I must \'feed\' it three crests and a creature\'s remains.|';
const DOUBLE_DOORS = '|@str@After \'feeding\' crests and a horn to the well I was able to|@str@pass through the double doors that lead to a huge cavern.|';
const KOFTIK_MAD = '|@str@I have seen Koftik again, I fear for his sanity. In his raving|@str@he did mention dwarfs that live in the south of this cavern.|';
const DWARVES = '|@str@I have met some dwarfs living here, the group leader said|@str@to seek a witch living on a platform above.|';
const STOLE_DOLL = '|@str@After distracting the witch I was able to steal a|@str@doll and a book. The book may give some clues.|';

const stageOf = (text: string): number | undefined => parseUpassJournal(text)?.stage;
const flagsOf = (text: string): ReadonlySet<string> => parseUpassJournal(text)?.flags ?? new Set();

describe('parseUpassJournal stages', () => {
    test('not started, and not yet sent to Koftik', () => {
        const text = '@dbl@I can start this quest by speaking to @dre@King Lathas@dbl@ who is in @dre@East Ardougne@dbl@.';
        expect(stageOf(text)).toBe(UP_STAGE.NOT_STARTED);
        expect(flagsOf(text).has(UP_FLAG.STARTED)).toBe(false);
    });

    test('started is a flag on stage zero, not a stage of its own', () => {
        const text = '@dbl@King Lathas asked me to meet a tracker named @dre@Koftik@dbl@. He can be found by a @dre@cave entrance@dbl@ in far @dre@West Ardougne.';
        expect(stageOf(text)).toBe(UP_STAGE.NOT_STARTED);
        expect(flagsOf(text).has(UP_FLAG.STARTED)).toBe(true);
    });

    test('spoken to Koftik', () => {
        const text = KOFTIK_DONE + '|@dbl@I have met Koftik. He fears these caves, but he agreed to help. He said to meet him at the @dre@bridge@dbl@ inside the cave.|';
        expect(stageOf(text)).toBe(UP_STAGE.SPOKEN_KOFTIK);
    });

    test('the damp cloth shows up as the arrow-parts flag', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + '|@dbl@I have met Koftik at an underground river where there is a drawbridge. But it\'s held up by @dre@ropes@dbl@ and pulleys. Koftik found a damp cloth amongst the charred remains of some arrows.';
        expect(stageOf(text)).toBe(UP_STAGE.SPOKEN_KOFTIK);
        expect(flagsOf(text).has(UP_FLAG.ARROW_PARTS)).toBe(true);
    });

    test('crossed the bridge', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + '|@dbl@I must work my way deeper into these caverns.|';
        expect(stageOf(text)).toBe(UP_STAGE.PASSED_BRIDGE);
    });

    test('down the well into the second area', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + ORBS + '@dbl@Something is watching me, I\'m starting to understand Koftik\'s fear.|';
        expect(stageOf(text)).toBe(UP_STAGE.ENTERED_SECOND_AREA);
    });

    test('unicorn crushed', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + ORBS + WATCHED + '|@dbl@I have found yet another @dre@well@dbl@. Upon it an inscription says that I must \'feed\' it @dre@three crests@dbl@ and a @dre@creature\'s remains@dbl@.';
        expect(stageOf(text)).toBe(UP_STAGE.KILLED_UNICORN);
        expect(flagsOf(text).has(UP_FLAG.WELL_INSCRIPTION)).toBe(true);
    });

    test('through the double doors', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + ORBS + WATCHED + SECOND_WELL + '|@dbl@After \'feeding\' crests and a horn to the well I was able to pass through the double doors that lead to a huge cavern.|';
        expect(stageOf(text)).toBe(UP_STAGE.ENTERED_MAIN_AREA);
    });

    test('spoken to Nilhoof', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + ORBS + WATCHED + SECOND_WELL + DOUBLE_DOORS + KOFTIK_MAD + '|@dbl@I have met some dwarfs living here, the group leader said to seek Iban\'s advisor: a @dre@witch@dbl@ living on a platform above.';
        expect(stageOf(text)).toBe(UP_STAGE.SPOKEN_NILHOOF);
        expect(flagsOf(text).has(UP_FLAG.KOFTIK_INSANE)).toBe(true);
    });

    test('doll stolen from the chest', () => {
        const text = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + ORBS + WATCHED + SECOND_WELL + DOUBLE_DOORS + KOFTIK_MAD + DWARVES + '|@dbl@After distracting the witch with her cat I was able to steal a doll and a book. The book may give some clues.|';
        expect(stageOf(text)).toBe(UP_STAGE.FOUND_DOLL);
    });

    test('quest complete', () => {
        const text = '@str@I have informed King Lathas that I have destroyed Iban.|@str@He told me that he would send magi to restore the well.||@dre@QUEST COMPLETE!';
        expect(stageOf(text)).toBe(UP_STAGE.COMPLETE);
    });

    test('unrecognised text is undefined, never a guessed stage', () => {
        expect(parseUpassJournal('@dbl@Some other quest entirely.')).toBeUndefined();
    });
});

describe('parseUpassJournal doll elements', () => {
    const base = KOFTIK_DONE + MET_KOFTIK + AT_BRIDGE + CROSSED + ORBS + WATCHED + SECOND_WELL + DOUBLE_DOORS + KOFTIK_MAD + DWARVES + STOLE_DOLL;

    test('each element sets its own flag', () => {
        const text = base
            + '|@dbl@Having burned Iban\'s tomb, I was able to collect some of his ashes. I rubbed some of the ash into the doll.|'
            + '|@dbl@I killed the huge blood-drinking spider, Kalrag. As it died I managed to smear some of its fluids onto the doll.|';
        const flags = flagsOf(text);
        expect(flags.has(UP_FLAG.ASHES_ON_DOLL)).toBe(true);
        expect(flags.has(UP_FLAG.BLOOD_ON_DOLL)).toBe(true);
        expect(flags.has(UP_FLAG.SHADOW_ON_DOLL)).toBe(false);
        expect(flags.has(UP_FLAG.DOVE_ON_DOLL)).toBe(false);
    });

    test('a finished doll is its own flag', () => {
        const text = base
            + '|@dbl@Having burned Iban\'s tomb, I was able to collect some of his ashes. I rubbed some of the ash into the doll.|'
            + '|@dbl@I killed the huge blood-drinking spider, Kalrag. As it died I managed to smear some of its fluids onto the doll.|'
            + '|@dbl@Collecting Shadow was tough, but after defeating 3 demons I was able to open a chest. The doll now has Iban\'s shadow.|'
            + '|@dbl@After searching some cages I found some dove bones. Crushing these over the doll imbued it with Iban\'s conscience|'
            + '|@dbl@I have completed the doll, all that remains is to face @dre@Iban@dbl@.|';
        const flags = flagsOf(text);
        expect(flags.has(UP_FLAG.DOLL_COMPLETE)).toBe(true);
        expect(flags.has(UP_FLAG.SHADOW_ON_DOLL)).toBe(true);
        expect(flags.has(UP_FLAG.DOVE_ON_DOLL)).toBe(true);
    });
});
