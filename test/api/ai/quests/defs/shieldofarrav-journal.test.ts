import { describe, expect, test } from 'bun:test';

import { SOA_STAGE, parseShieldOfArravJournal } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';

/** Lines as blackarmgang_journal.rs2 appends them: colour tags intact, pipes as breaks. */
const NOT_STARTED = [
    "@dbl@I can start this quest by speaking to @dre@Reldo@dbl@ in @dre@Varrock's|Palace Library@dbl@, or by speaking to the @dre@Tramp@dbl@ near|",
    '@dbl@the @dre@Blue Moon Inn@dbl@ in @dre@Varrock@dbl@.|'
];

const TOLD_OF_BOOK = [
    '@dre@Reldo@dbl@ says there is a @dre@quest@dbl@ hidden in one of the books in|his @dre@library somewhere. I should look for it and see.|'
];

const READ_BOOK = [
    '@str@I read about a valuable shield stolen long ago by a gang of|@str@thieves with an outstanding reward upon it.|',
    '@dbl@I should ask @dre@Reldo@dbl@ in the @dre@Varrock palace library@dbl@ if he knows anything more about this.|'
];

const SENT_TO_BARAEK = [
    '@str@I read about a valuable shield stolen long ago by a gang of|@str@thieves with an outstanding reward upon it.|',
    '@dbl@Reldo told me that the fur trader in @dre@Varrock@dbl@, named|@dre@Baraek@dbl@, knows about the @dre@Phoenix Gang@dbl@. I should speak to|him next.|'
];

const FIND_STRAVEN = [
    '@str@I read about a valuable shield stolen long ago by a gang of|@str@thieves with an outstanding reward upon it.|',
    "@dbl@Baraek told me that the @dre@'Phoenix Gang'@dbl@ have a hideout in|the @dre@south-eastern part of Varrock@dbl@, disguising themselves|",
    '@dbl@as the @dre@VTAM Corporation@dbl@. I should find them and join.|'
];

const KILL_JONNY_NO_REPORT = [
    '@str@as the VTAM Corporation.|',
    '@dbl@I spoke to @dre@Straven@dbl@ in the @dre@Phoenix Gang Headquarters|@dbl@south east of the @dre@Blue Moon Inn@dbl@. He offered to let me|',
    '@dbl@join the @dre@Gang@dbl@ in return for killing @dre@Jonny the Beard@dbl@ and|recovering an @dre@Intelligence Report@dbl@ from him. I can find|',
    '@dre@Jonny@dbl@ in the @dre@Blue Moon Inn@dbl@.|'
];

const KILL_JONNY_REPORT_HELD = [
    '@str@join the Gang in return for killing Jonny the Beard and|@str@recovering an Intelligence Report from him.|',
    '@dbl@I confronted and killed @dre@Jonny the Beard@dbl@ in the @dre@Blue|Moon Inn@dbl@ and took an @dre@Intelligence Report@dbl@ from him. I|',
    '@dbl@should take this @dre@Report@dbl@ to @dre@Straven@dbl@.|'
];

const PHOENIX_JOINED_NO_HALF = [
    '@dbl@gave this @dre@Report@dbl@ to @dre@Straven@dbl@ and he allowed me to join the|@dre@Phoenix Gang@dbl@. I can now search the @dre@Gang Headquarters|',
    '@dbl@ for the @dre@Shield of Arrav@dbl@.'
];

const PHOENIX_OWN_HALF = [
    '@str@gave this Report to Straven and he allowed me to join the|@str@Phoenix Gang.|',
    '@dbl@I searched the @dre@Phoenix Gang Headquarters@dbl@ and found|what seems to be half of the @dre@Shield of Arrav@dbl@. I should|',
    '@dbl@see if a @dre@Fellow Adventurer@dbl@ can find the other @dre@Shield Half@dbl@|and take them both to the @dre@Curator@dbl@ in @dre@Varrock Museum|'
];

const PHOENIX_BOTH_HALVES = [
    '@str@gave this Report to Straven and he allowed me to join the|@str@Phoenix Gang.|',
    '@dre@Fellow Adventurer@dbl@ also found a @dre@Shield Half@dbl@ and gave it to|me. I should take them both to the @dre@Curator@dbl@ in @dre@Varrock|'
];

const PHOENIX_TWO_CERTS = [
    '@str@gave this Report to Straven and he allowed me to join the|@str@Phoenix Gang.|',
    '@dbl@who confirmed they were genuine. The @dre@Curator@dbl@ gave me|two @dre@Certificates@dbl@. I should now give one to a @dre@Fellow|',
    '@dre@Adventurer@dbl@ and take my @dre@Certificate@dbl@ to @dre@King Roald|@dbl@in @dre@Varrock Palace@dbl@ to collect my reward.'
];

const TRAMP_TOLD = [
    '@str@To start this quest, I spoke to the Tramp in Varrock.|@str@He gave me the location of the Black Arm Gang HQ.|',
    '@dbl@He directed me to speak to @dre@Katrine@dbl@ in the @dre@gang HQ@dbl@.|'
];

const KATRINE_TASK = [
    '@str@He directed me to speak to Katrine in the Gang|@str@Headquarters.|',
    '@dbl@I spoke to @dre@Katrine@dbl@ in the @dre@Black Arm Gang Headquarters.|@dbl@She offered to let me join the gang in return for|',
    '@dbl@stealing two @dre@Phoenix Crossbows@dbl@ from the @dre@Phoenix Gang.@dbl@|',
    '@dbl@I should seek help by asking a @dre@Fellow Adventurer@dbl@ to|infiltrate the Phoenix Gang@dbl@.|'
];

const KATRINE_TASK_KEY_HELD = [
    '@dbl@stealing two @dre@Phoenix Crossbows@dbl@ from the @dre@Phoenix Gang.@dbl@|',
    "@dbl@With the help of a @dre@Fellow Adventurer@dbl@, I was able to obtain a|@dre@Key@dbl@ to the @dre@Phoenix Gang's Weapon Stash@dbl@ south east of|",
    '@dbl@the @dre@Blue Moon Inn@dbl@. I should now be able to steal the @dre@Crossbows|'
];

const KATRINE_TASK_CROSSBOWS = [
    '@dbl@stealing two @dre@Phoenix Crossbows@dbl@ from the @dre@Phoenix Gang.@dbl@|',
    '@dbl@With the help of a @dre@Fellow Adventurer@dbl@, I was able to obtain|these @dre@Crossbows@dbl@. @dbl@I should now return them to @dre@Katrine@dbl@.|'
];

const BLACKARM_JOINED = [
    '@dbl@allowed me to join the @dre@Black Arm Gang@dbl@. I can now search|the @dre@Gang Headquarters@dbl@ for the @dre@Shield of Arrav@dbl@.|'
];

const COMPLETE = [
    '@str@and he rewarded me for helping to return the Shield of|@str@Arrav.||',
    '@red@QUEST COMPLETE!'
];

describe('arrav journal', () => {
    test('an unrendered page yields no progress', () => {
        expect(parseShieldOfArravJournal([])).toBeUndefined();
        expect(parseShieldOfArravJournal(['@dbl@'])).toBeUndefined();
    });

    test('phoenix stages read in order', () => {
        expect(parseShieldOfArravJournal(NOT_STARTED)?.stage).toBe(SOA_STAGE.NOT_STARTED);
        expect(parseShieldOfArravJournal(TOLD_OF_BOOK)?.stage).toBe(SOA_STAGE.TOLD_OF_BOOK);
        expect(parseShieldOfArravJournal(READ_BOOK)?.stage).toBe(SOA_STAGE.READ_BOOK);
        expect(parseShieldOfArravJournal(SENT_TO_BARAEK)?.stage).toBe(SOA_STAGE.SENT_TO_BARAEK);
        expect(parseShieldOfArravJournal(FIND_STRAVEN)?.stage).toBe(SOA_STAGE.FIND_STRAVEN);
        expect(parseShieldOfArravJournal(KILL_JONNY_NO_REPORT)?.stage).toBe(SOA_STAGE.KILL_JONNY);
        expect(parseShieldOfArravJournal(PHOENIX_JOINED_NO_HALF)?.stage).toBe(SOA_STAGE.PHOENIX_JOINED);
    });

    test('black arm stages read in order', () => {
        expect(parseShieldOfArravJournal(TRAMP_TOLD)?.stage).toBe(SOA_STAGE.TRAMP_TOLD);
        expect(parseShieldOfArravJournal(KATRINE_TASK)?.stage).toBe(SOA_STAGE.KATRINE_TASK);
        expect(parseShieldOfArravJournal(BLACKARM_JOINED)?.stage).toBe(SOA_STAGE.BLACKARM_JOINED);
    });

    test('every phoenix joined page reads as joined, whatever is carried', () => {
        for (const page of [PHOENIX_JOINED_NO_HALF, PHOENIX_OWN_HALF, PHOENIX_BOTH_HALVES, PHOENIX_TWO_CERTS]) {
            expect(parseShieldOfArravJournal(page)?.stage).toBe(SOA_STAGE.PHOENIX_JOINED);
        }
    });

    test('every katrine task page reads as the task, whatever is carried', () => {
        for (const page of [KATRINE_TASK, KATRINE_TASK_KEY_HELD, KATRINE_TASK_CROSSBOWS]) {
            expect(parseShieldOfArravJournal(page)?.stage).toBe(SOA_STAGE.KATRINE_TASK);
        }
    });

    test('complete outranks every other needle on the page', () => {
        expect(parseShieldOfArravJournal(COMPLETE)?.stage).toBe(SOA_STAGE.COMPLETE);
    });

    test('the report flag separates the two kill-jonny pages', () => {
        expect(parseShieldOfArravJournal(KILL_JONNY_NO_REPORT)?.flags.has('report-held')).toBe(false);
        expect(parseShieldOfArravJournal(KILL_JONNY_REPORT_HELD)?.flags.has('report-held')).toBe(true);
    });

    test('the struck-through killed-jonny line is not read as a held report once joined', () => {
        const joined = [
            '@str@I confronted and killed Jonny the Beard in the Blue|@str@Moon Inn and took an Intelligence Report from him. I|',
            '@str@gave this Report to Straven and he allowed me to join the|@str@Phoenix Gang.|'
        ];
        expect(parseShieldOfArravJournal(joined)?.flags.has('report-held')).toBe(false);
    });

    test('the key and crossbow flags separate the three katrine-task pages', () => {
        expect(parseShieldOfArravJournal(KATRINE_TASK)?.flags.has('key-held')).toBe(false);
        expect(parseShieldOfArravJournal(KATRINE_TASK_KEY_HELD)?.flags.has('key-held')).toBe(true);
        expect(parseShieldOfArravJournal(KATRINE_TASK_CROSSBOWS)?.flags.has('crossbows-held')).toBe(true);
    });

    test('the half and certificate flags separate the four joined pages', () => {
        expect(parseShieldOfArravJournal(PHOENIX_JOINED_NO_HALF)?.flags.size).toBe(0);
        expect(parseShieldOfArravJournal(PHOENIX_OWN_HALF)?.flags.has('own-half-only')).toBe(true);
        expect(parseShieldOfArravJournal(PHOENIX_BOTH_HALVES)?.flags.has('both-halves')).toBe(true);
        expect(parseShieldOfArravJournal(PHOENIX_TWO_CERTS)?.flags.has('two-certificates')).toBe(true);
    });

    test('a colour tag next to punctuation does not split a needle', () => {
        const tagged = ['@dbl@stealing two @dre@Phoenix Crossbows@dbl@ from the @dre@Phoenix Gang.@dbl@|'];
        expect(parseShieldOfArravJournal(tagged)?.stage).toBe(SOA_STAGE.KATRINE_TASK);
    });
});
