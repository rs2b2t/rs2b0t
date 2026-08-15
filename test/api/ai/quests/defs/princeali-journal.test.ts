import { describe, expect, test } from 'bun:test';

import { PRINCE_STAGE, parsePrinceJournal } from '#/bot/api/ai/quests/defs/princeali/journal.js';

const INTRO =
    '@str@Prince Ali has been kidnapped but luckily the spy Leela|@str@has found he is being held near draynor village. I will|'
    + '@str@need to disguise the Prince and tie up his captor to free|@str@him from their clutches.|';
const DRUNK = '@str@I also had to prevent the Guard from seeing what I was up|@str@to, by getting him drunk.|';
const TIED = '@str@With the guard disposed of, I used my rope to tie up Lady|@str@Keli in a cupboard, so I could disguise the Prince.|';
const SAVED =
    '@str@I then used a wig, a skirt and some skin paste to make the|@str@prince look like Lady Keli so he could escape to his|'
    + '@str@freedom with Leela after unlocking his cell door.|';

const JOURNAL: Record<number, string> = {
    [PRINCE_STAGE.NOT_STARTED]:
        '@dbl@I can start this quest by speaking to @dre@Hassan@dbl@ in @dre@Al-Kharid Palace@dbl@.',
    [PRINCE_STAGE.STARTED]:
        '@str@I started this quest by speaking to Hassan in Al-Kharid|@str@Palace. He told me I should speak to Osman the spy master.|'
        + '@dbl@I should go and speak to @dre@Osman@dbl@ for details on the quest.',
    [PRINCE_STAGE.SPOKEN_OSMAN]:
        '@str@Prince Ali has been kidnapped but luckily the spy Leela|@str@has found he is being held near draynor village. I will|'
        + '@str@need to disguise the Prince and tie up his captor to free|@str@him from their clutches. To do this I should:||'
        + '@dbl@Talk to @dre@Leela@dbl@ near @dre@Draynor Village@dbl@ for advice|'
        + '@dbl@Get a duplicate of the key that is imprisoning the prince|'
        + '@dbl@Get some rope to tie up the Princes\' kidnapper|',
    [PRINCE_STAGE.PREP_FINISHED]:
        INTRO
        + '@dbl@Before I can free @dre@Prince Ali@dbl@, I need to deal with the @dre@Guard@dbl@.|'
        + '@dre@Leela@dbl@ suggested I speak with the @dre@Guard@dbl@ to try and determine any weaknesses he might have.|',
    [PRINCE_STAGE.GUARD_DRUNK]:
        INTRO + DRUNK
        + '@dbl@The last thing I need to do is deal with @dre@Lady Keli@dbl@.|@dre@Leela@dbl@ suggested I use some @dre@Rope@dbl@ to tie her up.',
    [PRINCE_STAGE.TIED_KELI]:
        INTRO + DRUNK + TIED
        + '@dbl@I can now free @dre@Prince Ali@dbl@. I\'ll need to make sure I give him his disguise when I do.',
    [PRINCE_STAGE.SAVED]:
        INTRO + DRUNK + TIED + SAVED + '@dbl@I should return to @dre@Hassan@dbl@ to claim my reward.',
    [PRINCE_STAGE.COMPLETE]:
        '@str@I started this quest by speaking to Hassan in Al-Kharid|@str@Palace. He told me I should speak to Osman the spy master.|'
        + '@str@I should go and speak to Osman for details on the quest.|'
        + INTRO + DRUNK + TIED + SAVED
        + '@str@I returned to Al-Kharid where Hassan rewarded me for|@str@my work.||@red@QUEST COMPLETE!'
};

describe('prince journal', () => {
    for (const [stage, text] of Object.entries(JOURNAL)) {
        test(`stage ${stage} reads back as itself`, () => {
            expect(parsePrinceJournal(text)?.stage).toBe(Number(stage));
        });
    }

    test('later entries keep the earlier history, so needles must be newest-first', () => {
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.TIED_KELI])?.stage).toBe(PRINCE_STAGE.TIED_KELI);
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.SAVED])?.stage).toBe(PRINCE_STAGE.SAVED);
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.COMPLETE])?.stage).toBe(PRINCE_STAGE.COMPLETE);
    });

    test('"for advice" is unique to stage 20 and does not leak into 30', () => {
        expect(JOURNAL[PRINCE_STAGE.PREP_FINISHED]).not.toContain('for advice');
    });

    test('stage 40\'s "need to do is deal with" is not stage 30\'s "need to deal with the"', () => {
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.GUARD_DRUNK])?.stage).toBe(PRINCE_STAGE.GUARD_DRUNK);
    });

    test('an array of lines parses the same as the joined string', () => {
        expect(parsePrinceJournal(['@red@QUEST', 'COMPLETE!'])?.stage).toBe(PRINCE_STAGE.COMPLETE);
    });

    test('an empty journal is undefined, not stage 0', () => {
        expect(parsePrinceJournal([])).toBeUndefined();
        expect(parsePrinceJournal('')).toBeUndefined();
    });

    test('unrecognised text is undefined', () => {
        expect(parsePrinceJournal('@str@Some other quest entirely.')).toBeUndefined();
    });

    test('flags are always empty — the stage carries everything', () => {
        expect(parsePrinceJournal(JOURNAL[PRINCE_STAGE.SPOKEN_OSMAN])?.flags.size).toBe(0);
    });
});
