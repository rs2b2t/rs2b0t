import { describe, expect, test } from 'bun:test';

import { SM_STAGE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { parseMorttonJournal } from '#/bot/api/ai/quests/defs/mortton/journal.js';

/** The cumulative `@str@` prose mortton_journal.rs2 appends, in the order it appends it. */
const HISTORY = {
    readDiary: '@str@I can start this quest by exploring the town of Mort\'ton|@str@which is accessible from the southern edge of Mort Myre.|',
    madeSerum: '@str@I made my way down through Mort Myre and found the town|@str@of Mort\'ton. I discovered a diary which had some notes on|@str@a special serum in it. I made the serum.|',
    killShades: '@str@I made serum 207 from tarromin, water and ashes by using|@str@Herbi Flax\'s diary. I wonder what the serum is used for?|'
        + '@str@I used the serum on a local NPC and I\'ve been able to ask|@str@a few questions about the place.|'
        + '@str@I talked to Razmire Keelgan and he asked me to kill five|@str@shades for him. He seems to hate them!|',
    toRazmire: '@str@I\'ve killed five shades and showed the remains to Razmire.|@str@Razmire told me to show the remains to Ulsquire.|',
    toUlsquire: '@str@I showed Ulsquire the shade remains and he gave me some|@str@information which may be useful.|',
    rebuild: '@str@Ulsquire seems to know a lot about this area, he\'s quite|@str@interested in \'Flaemtaer temple\' and wishes he could|@str@rebuild it.|',
    canLight: '@str@I helped rebuild the temple using limestone bricks, wooden|@str@planks and nails.|',
    sacredOil: '@str@When all of the temple walls were rebuilt, a fire altar|@str@appeared. The flame from the altar was sacred.|@str@I placed a flask of olive oil in the flame and it became|@str@sacred oil.|',
    pyreLogs: '@str@I used sacred oil on logs turning them into pyre logs.|',
    onPyre: '@str@I placed some pyre logs onto a funeral pyre.|',
    litPyre: '@str@I placed the shade remains on the pyre and set it on fire in|@str@order to put the Shades to rest.|'
};

const NOT_STARTED = '@dbl@I can start this quest by exploring the town of @dre@Mort\'ton@dbl@ which is accessible from the southern edge of @dre@Mort Myre@dbl@.';

/** Every page is the history so far plus the one `@dbl@` line naming the current task. */
const page = (history: string, current: string): string => history + current;

describe('mortton journal stages', () => {
    test('an unstarted quest', () => {
        expect(parseMorttonJournal(NOT_STARTED)).toBe(SM_STAGE.NOT_STARTED);
    });

    test('the diary has been read', () => {
        const text = page(HISTORY.readDiary, '@dbl@I made my way down through @dre@Mort Myre@dbl@ and I found the town of @dre@Mort\'ton@dbl@. I\'ve found a @dre@diary@dbl@ which has some interesting @dre@notes@dbl@ in it. Perhaps this can help me?');
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.READ_DIARY);
    });

    test('the serum is brewed but unused', () => {
        const text = page(HISTORY.readDiary + HISTORY.madeSerum, '@dbl@I made @dre@serum 207@dbl@ from tarromin, water and ashes by using @dre@Herbi Flax\'s@dbl@ diary. I wonder what the @dre@serum@dbl@ is used for?');
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.MADE_SERUM);
    });

    test('the serum has been used on a villager', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum,
            '@str@I made serum 207 from tarromin, water and ashes by|@str@using Herbi Flax\'s diary. I wonder what the serum is used|@str@for?|'
            + '@dbl@I used the @dre@serum@dbl@ on a local NPC and I\'ve been able to ask a few questions about the place.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.MADE_SERUM);
    });

    test('the shade hunt counts up', () => {
        const base = HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades;
        const counted: [string, number][] = [
            ['@dbl@I have to kill @dre@five@dbl@ shades.', SM_STAGE.KILL_SHADES],
            ['@dbl@I\'ve killed @dre@one@dbl@ shade, I need to kill another @dre@four@dbl@.', SM_STAGE.KILLED_1],
            ['@dbl@I\'ve killed @dre@two@dbl@ shades, I need to kill another @dre@three@dbl@.', SM_STAGE.KILLED_2],
            ['@dbl@I\'ve killed @dre@three@dbl@ shades, I need to kill another @dre@two@dbl@.', SM_STAGE.KILLED_3],
            ['@dbl@I\'ve killed @dre@four@dbl@ shades, I need to kill another @dre@one@dbl@.', SM_STAGE.KILLED_4],
            ['@dbl@I\'ve killed all @dre@five shades@dbl@, I should return to @dre@Razmire@dbl@ now.', SM_STAGE.KILLED_5]
        ];
        for (const [current, stage] of counted) {
            expect(parseMorttonJournal(page(base, current))).toBe(stage);
        }
    });

    test('the remains are owed to Ulsquire', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire,
            '@dbl@I should show the @dre@shade@dbl@ remains to @dre@Ulsquire@dbl@.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.SHADES_TO_RAZMIRE);
    });

    test('Ulsquire has studied the remains', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire,
            '@dre@Ulsquire@dbl@ seems to know a lot about this area, maybe if I @dre@investigate@dbl@ around here a little more I can help the locals.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.SHADES_TO_ULSQUIRE);
    });

    test('the temple has been named', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire,
            '@dre@Ulsquire@dbl@ seems to know a lot about this area, he\'s quite interested in @dre@\'Flaemtaer temple\'@dbl@ and wishes he could rebuild it.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.ULSQUIRE_TEMPLE);
    });

    test('the rebuild has started', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire + HISTORY.rebuild,
            '@dbl@I\'ve started @dre@rebuilding@dbl@ the @dre@temple@dbl@ using @dre@limestone bricks@dbl@, @dre@wooden planks@dbl@ and @dre@nails@dbl@. I wonder what @dre@power@dbl@ the @dre@temple@dbl@ has, if any?|'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.REBUILD_TEMPLE);
    });

    test('the altar can be lit', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire
            + HISTORY.rebuild + HISTORY.canLight,
            '@dbl@There must be some way to make use of the @dre@altar@dbl@ that appears in the @dre@middle@dbl@ of the @dre@temple@dbl@.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.CAN_LIGHT_ALTAR);
    });

    test('the oil has been sanctified', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire
            + HISTORY.rebuild + HISTORY.canLight + HISTORY.sacredOil,
            '@dre@Ulsquire@dbl@ said something about putting the @dre@Shades@dbl@ to rest by giving them a @dre@holy cremation@dbl@, maybe this @dre@oil@dbl@ can help?'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.CREATED_SACRED_OIL);
    });

    test('the pyre logs exist', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire
            + HISTORY.rebuild + HISTORY.canLight + HISTORY.sacredOil + HISTORY.pyreLogs,
            '@dbl@I have some @dre@Shade@dbl@ remains and I have some @dre@pyre logs@dbl@, I can now try to put a @dre@shades@dbl@ spirit to rest.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.CREATED_PYRE_LOGS);
    });

    test('the logs are on the pyre', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire
            + HISTORY.rebuild + HISTORY.canLight + HISTORY.sacredOil + HISTORY.pyreLogs + HISTORY.onPyre,
            '@dbl@I need to put the @dre@shade remains@dbl@ on the @dre@funeral pyre@dbl@ and then @dre@light@dbl@ it in order to put the@dre@ shade spirit@dbl@ to rest.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.LOGS_ON_PYRE);
    });

    test('the pyre is lit', () => {
        const text = page(
            HISTORY.readDiary + HISTORY.madeSerum + HISTORY.killShades + HISTORY.toRazmire + HISTORY.toUlsquire
            + HISTORY.rebuild + HISTORY.canLight + HISTORY.sacredOil + HISTORY.pyreLogs + HISTORY.onPyre + HISTORY.litPyre,
            '@dbl@The @dre@shades spirit@dbl@ was released, I should tell @dre@Ulsquire@dbl@.'
        );
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.LIT_PYRE);
    });

    test('the completed page', () => {
        const text = '@str@I travelled to the town of Mort\'ton where the people had an|@str@affliction.|@red@QUEST COMPLETE!';
        expect(parseMorttonJournal(text)).toBe(SM_STAGE.COMPLETE);
    });

    test('an empty page is not a stage', () => {
        expect(parseMorttonJournal([])).toBeUndefined();
    });

    test('the page arrives as lines and reads the same', () => {
        expect(parseMorttonJournal(['@dbl@I have to kill @dre@five@dbl@ shades.'])).toBe(SM_STAGE.KILL_SHADES);
    });
});
