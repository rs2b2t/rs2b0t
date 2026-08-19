import { describe, expect, test } from 'bun:test';

import { IKOV_STAGE, parseIkovJournal } from '#/bot/api/ai/quests/defs/ikov/journal.js';

/** Lines as ikov_journal.rs2 appends them: colour tags intact, pipes as breaks. */
const NOT_STARTED = [
    '@dbl@I can start this quest at the @dre@Flying Horse Inn@dbl@ in @dre@Ardougne@dbl@ by speaking to @dbl@Lucien||',
    '@dbl@I must have:|',
    '@dre@Level 42 thieving|',
    '@dre@Level 40 ranged|'
];

const STARTED = [
    '@dre@Lucien@dbl@ has asked me to retrieve the @dre@Staff of Armadyl@dbl@ from the @dre@Temple of Ikov@dbl@.'
        + ' The entrance is near @dre@Hemenster@dbl@. He has given me a @dre@pendant@dbl@ so I can enter the @dre@chamber of fear.'
];

const PREFIX = [
    '@str@Lucien has asked me to retrieve the Staff of Armadyl from|',
    '@str@the Temple of Ikov. The entrance is near Hemenster. He has|',
    '@str@given me a pendant so I can enter the chamber of fear.|'
];

const TRAP = [
    ...PREFIX,
    '@str@I have entered the chamber of fear. I found a trap on a|',
    '@str@lever and have disabled it. I pulled the lever.|',
    '@str@I have found some boots of lightness. I have entered the|',
    '@str@Ice Cavern and found some arrows made of ice.'
];

const WARRIOR = [
    ...PREFIX,
    '@str@I have entered the chamber of fear. I found a trap on a|',
    '@str@lever and have disabled it. I pulled the lever; I went into|',
    '@str@another chamber and was attacked by a Fire Warrior! I|',
    '@str@killed it using arrows made of ice and my trusty bow.|'
];

const SPOKEN_WINELDA = [
    ...WARRIOR,
    '|@dbl@My path is blocked by lava. @dre@Winelda@dbl@ will teleport me across if I first get her @dre@twenty limpwurt roots'
];

const PAID_WINELDA = [
    ...WARRIOR,
    '|@str@My path was blocked by lava. Winelda teleported me across|',
    '@str@after I got her twenty limpwurt roots.|'
];

const HELPING_ARMADYL = [
    ...PAID_WINELDA,
    '|@dbl@I agreed to help the @dre@Guardians of Armadyl@dbl@, I will kill @dre@Lucien@dbl@.'
        + ' The guardians gave me a @dre@pendant@dbl@ that I will need to enable me to attack him'
];

const COMPLETE = [
    ...PAID_WINELDA,
    '|@str@I agreed to help the Guardians of Armadyl. I killed|',
    '@str@Lucien and banished him from this plane!|',
    '|@dre@QUEST COMPLETE!'
];

describe('parseIkovJournal', () => {
    const cases: [string, string[], number][] = [
        ['not started', NOT_STARTED, IKOV_STAGE.NOT_STARTED],
        ['started', STARTED, IKOV_STAGE.STARTED],
        ['trap disarmed and lever pulled', TRAP, IKOV_STAGE.PULLED_LEVER],
        ['Fire Warrior down', WARRIOR, IKOV_STAGE.KILLED_WARRIOR],
        ['Winelda wants roots', SPOKEN_WINELDA, IKOV_STAGE.SPOKEN_WINELDA],
        ['Winelda paid', PAID_WINELDA, IKOV_STAGE.PAID_WINELDA],
        ['helping the guardians', HELPING_ARMADYL, IKOV_STAGE.HELPING_ARMADYL],
        ['complete', COMPLETE, IKOV_STAGE.COMPLETE]
    ];

    for (const [label, lines, stage] of cases) {
        test(`reads ${label}`, () => {
            expect(parseIkovJournal(lines)).toBe(stage);
        });
    }

    // Why: every earlier line stays on the page struck through, so a later page still contains the earlier needles.
    test('a later page outranks the struck-through lines it still carries', () => {
        expect(parseIkovJournal(WARRIOR)).toBeGreaterThan(parseIkovJournal(TRAP)!);
        expect(parseIkovJournal(PAID_WINELDA)).toBeGreaterThan(parseIkovJournal(SPOKEN_WINELDA)!);
        expect(parseIkovJournal(HELPING_ARMADYL)).toBeGreaterThan(parseIkovJournal(PAID_WINELDA)!);
    });

    test('stage 20 and stage 30 render one page, so both read as PULLED_LEVER', () => {
        expect(parseIkovJournal(TRAP)).toBe(IKOV_STAGE.PULLED_LEVER);
    });

    test('an empty read is not a stage', () => {
        expect(parseIkovJournal([])).toBeUndefined();
        expect(parseIkovJournal('')).toBeUndefined();
    });

    test('a page of unrelated text is not a stage', () => {
        expect(parseIkovJournal(['@dbl@I can start this quest by speaking to @dre@Reldo@dbl@.'])).toBeUndefined();
    });

    // Why: colour tags and line breaks both normalise to one space, so a needle reads the same wherever they fall.
    test('needles survive the colour tags and breaks inside them', () => {
        expect(parseIkovJournal(['@str@I killed it using @dre@arrows made of ice@dbl@ and my bow.'])).toBe(IKOV_STAGE.KILLED_WARRIOR);
        expect(parseIkovJournal(['@str@I killed it using arrows|@str@made of ice and my bow.'])).toBe(IKOV_STAGE.KILLED_WARRIOR);
    });
});
