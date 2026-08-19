import { describe, expect, test } from 'bun:test';

import { DIG_STAGE, parseDigsiteJournal } from '#/bot/api/ai/quests/defs/digsite/journal.js';

/** Chunks as itexam_journal.rs2 appends them: colour tags intact, pipes as breaks. */
const OPENING = '@str@I should speak to the Examiner about taking Earth|@str@Science Exams.|';
const STAMP_DONE = [
    '|@str@I should take the letter the Examiner has given me|@str@to the Curator of the Varrock Museum for his approval.|',
    '|@str@I need to return the letter of recommendation from the|@str@Curator of Varrock Museum, to the Examiner at the|@str@Exam Centre for inspection.|'
];

const NOT_STARTED = [
    '@dbl@I can start this quest by speaking to the @dre@Examiner @dbl@at the @dre@Digsite Exam Centre.|',
    '|@dbl@To complete this quest I need:|',
    '@dre@Level 10 Agility|',
    '@dre@Level 10 Herblore|',
    '@dre@Level 25 Thieving|'
];

const STAMPING_NO_LETTER = [
    OPENING,
    '|@dbl@I should take the @dre@letter @dbl@the @dre@Examiner @dbl@has given me to the @dre@Curator of the Varrock Museum @dbl@for his approval.'
];

const STAMPING_LETTER_HELD = [
    OPENING,
    '|@str@I should take the letter the Examiner has given me|@str@to the Curator of the Varrock Museum for his approval.|',
    '|@dbl@I need to return the @dre@letter of recommendation @dbl@from the @dre@Curator of Varrock Museum@dbl@, to the @dre@Examiner @dbl@at the|@dbl@Exam Centre for inspection.|'
];

const GREEN_TODO = '|@dbl@I need to speak to the student in the green top about the exams.';
const PURPLE_TODO = '|@dbl@I need to speak to the student in the purple shirt about the exams.';
const ORANGE_TODO = '|@dbl@I need to speak to the student in the orange top about the exams.';

const GREEN_DONE = [
    '|@str@I need to speak to the student in the green top about the|@str@exams.',
    '|@str@He gave me an answer to one of the questions on the first|@str@exam.'
];
const PURPLE_DONE = [
    '|@str@I need to speak to the student in the purple shirt about|@str@the exams.',
    '|@str@She gave me an answer to one of the questions on the|@str@first exam.'
];
const ORANGE_DONE = [
    '|@str@I need to speak to the student in the orange top about the|@str@exams.',
    '|@str@He gave me an answer to one of the questions on the first|@str@exam.'
];

const GREEN_STARTED = [
    '|@str@I need to speak to the student in the green top about the|@str@exams.',
    '|@dbl@I have agreed to help the student in the green top.|',
    'He has lost his rock sample and thinks he may have dropped it around the digsite.|I need to find it and return it to him.'
];

const READY = '|@dbl@I should talk to the Examiner to take my first exam. If I have forgotten anything I can always ask the students again.';

const FIRST_EXAM_HEAD = [
    OPENING,
    ...STAMP_DONE,
    '|@dbl@I need to study for my first exam. Perhaps the @dre@students @dbl@on the digsite can help?|'
];

const PASSED_1 = '|@str@I have passed my first Earth Science exam.|';
const PASSED_2 = '|@str@I have passed my second Earth Science exam.|';
const PASSED_3 = '|@str@I have passed my third Earth Science exam.|';

const SECOND_EXAM = [
    OPENING,
    ...STAMP_DONE,
    PASSED_1,
    '|@dbl@I need to study for my second exam. Perhaps the three students on the digsite can help me again?|',
    GREEN_TODO,
    PURPLE_TODO,
    ORANGE_TODO
];

const THIRD_EXAM_OPAL = [
    OPENING,
    ...STAMP_DONE,
    PASSED_1,
    PASSED_2,
    '|@dbl@I need to study for my third exam. Perhaps the three students on the digsite can help me again?|',
    '|@str@I need to speak to the student in the green top about the|@str@exams.',
    '|@str@I need to speak to the student in the purple shirt about|@str@the exams.',
    '|@dbl@I need to bring her an opal.',
    ORANGE_TODO
];

const IMPRESS_EXPERT = [
    OPENING,
    ...STAMP_DONE,
    PASSED_1,
    PASSED_2,
    PASSED_3,
    '|@dbl@I need a find from the site to impress the @dre@archeological expert at the Exam Centre.',
    '|@dbl@I need to take the @dre@letter @dbl@to a workman near a @dre@winch.'
];

const PERMIT = [
    OPENING,
    ...STAMP_DONE,
    PASSED_1,
    PASSED_2,
    PASSED_3,
    '|@str@I need a find from the site to impress the archeological|@str@expert at the Exam Centre.',
    '|@str@I need to take the letter to a workman near a winch.|',
    '|@dbl@I need to @dre@investigate the dig shafts.',
    '|@dbl@I need to find a way to move the rocks blocking the way in the shaft. Perhaps someone else in these dig shafts can help me.'
];

const POURED = [
    ...PERMIT.slice(0, -2),
    '|@str@I need to investigate the dig shafts.',
    '|@str@I need to find a way to move the rocks blocking the way|@str@in the shaft. Perhaps someone else in these dig shafts|@str@can help me.|',
    '|@str@I covered the rocks in the cave with an explosive compound.|',
    '|@dbl@I need to ignite the explosive compound and blow up the rocks blocking the way.'
];

const BLOWN = [
    ...POURED.slice(0, -1),
    '|@str@I need to ignite the explosive compound and blow up the|@str@rocks blocking the way.|',
    '|@dbl@I should look for an interesting find in the secret room I found, and show it to @dre@the archeological expert@dbl@ at the Exam Centre.'
];

const COMPLETE = [
    ...BLOWN.slice(0, -1),
    '|@str@I should look for an interesting find in the secret room I|@str@found, and show it to the archeological expert|@str@at the Exam Centre.|',
    '|@str@The expert was impressed with the Zarosian tablet that I|@str@found, and I also discovered an ancient altar!',
    '|@red@QUEST COMPLETE!'
];

const PAGES: readonly [string, string[], number][] = [
    ['not started', NOT_STARTED, DIG_STAGE.NOT_STARTED],
    ['stamping without the letter', STAMPING_NO_LETTER, DIG_STAGE.STAMPING],
    ['stamping with the letter', STAMPING_LETTER_HELD, DIG_STAGE.STAMPING],
    ['first exam', [...FIRST_EXAM_HEAD, GREEN_TODO, PURPLE_TODO, ORANGE_TODO], DIG_STAGE.FIRST_EXAM],
    ['second exam', SECOND_EXAM, DIG_STAGE.SECOND_EXAM],
    ['third exam', THIRD_EXAM_OPAL, DIG_STAGE.THIRD_EXAM],
    ['impress the expert', IMPRESS_EXPERT, DIG_STAGE.IMPRESS_EXPERT],
    ['mineshaft permit', PERMIT, DIG_STAGE.MINESHAFT_PERMIT],
    ['compound poured', POURED, DIG_STAGE.POURED_COMPOUND],
    ['blockage removed', BLOWN, DIG_STAGE.REMOVED_BLOCKAGE],
    ['complete', COMPLETE, DIG_STAGE.COMPLETE]
];

describe('Digsite journal stages', () => {
    for (const [name, page, stage] of PAGES) {
        test(`reads ${name}`, () => {
            expect(parseDigsiteJournal(page)?.stage).toBe(stage);
        });
    }

    test('an empty page is unreadable rather than not started', () => {
        expect(parseDigsiteJournal([])).toBeUndefined();
        expect(parseDigsiteJournal(['   '])).toBeUndefined();
    });
});

describe('Digsite journal flags', () => {
    test('no errand answered leaves every student flag clear', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, GREEN_TODO, PURPLE_TODO, ORANGE_TODO])?.flags;
        expect(flags?.has('green-answered')).toBe(false);
        expect(flags?.has('purple-answered')).toBe(false);
        expect(flags?.has('orange-answered')).toBe(false);
        expect(flags?.has('exam-ready')).toBe(false);
    });

    test('the green student alone reads as green, not orange', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, ...GREEN_DONE, PURPLE_TODO, ORANGE_TODO])?.flags;
        expect(flags?.has('green-answered')).toBe(true);
        expect(flags?.has('orange-answered')).toBe(false);
    });

    test('the orange student alone reads as orange, not green', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, GREEN_TODO, PURPLE_TODO, ...ORANGE_DONE])?.flags;
        expect(flags?.has('orange-answered')).toBe(true);
        expect(flags?.has('green-answered')).toBe(false);
    });

    test('a started errand is not an answered one', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, ...GREEN_STARTED, PURPLE_TODO, ORANGE_TODO])?.flags;
        expect(flags?.has('green-answered')).toBe(false);
    });

    test('all three answered sets every flag and exam-ready', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, ...GREEN_DONE, ...PURPLE_DONE, ...ORANGE_DONE, READY])?.flags;
        expect(flags?.has('green-answered')).toBe(true);
        expect(flags?.has('purple-answered')).toBe(true);
        expect(flags?.has('orange-answered')).toBe(true);
        expect(flags?.has('exam-ready')).toBe(true);
    });

    test('the purple student\'s "She gave me an answer" is not the other two\'s line', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, ...GREEN_DONE, ...PURPLE_DONE, ORANGE_TODO])?.flags;
        expect(flags?.has('green-answered')).toBe(true);
        expect(flags?.has('purple-answered')).toBe(true);
        expect(flags?.has('orange-answered')).toBe(false);
    });

    test('the purple student alone answers nobody else', () => {
        const flags = parseDigsiteJournal([...FIRST_EXAM_HEAD, GREEN_TODO, ...PURPLE_DONE, ORANGE_TODO])?.flags;
        expect(flags?.has('purple-answered')).toBe(true);
        expect(flags?.has('green-answered')).toBe(false);
        expect(flags?.has('orange-answered')).toBe(false);
    });

    test('the purple student wanting an opal is its own flag', () => {
        expect(parseDigsiteJournal(THIRD_EXAM_OPAL)?.flags.has('opal-wanted')).toBe(true);
    });

    test('a struck-through earlier stage never wins over the live one', () => {
        expect(parseDigsiteJournal(BLOWN)?.stage).toBe(DIG_STAGE.REMOVED_BLOCKAGE);
        expect(parseDigsiteJournal(COMPLETE)?.stage).toBe(DIG_STAGE.COMPLETE);
    });
});
