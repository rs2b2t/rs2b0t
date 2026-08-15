import { describe, expect, test } from 'bun:test';

import { NS_STAGE } from '#/bot/api/ai/quests/defs/druidspirit/areas.js';
import { NS_FLAG, parseDruidJournal } from '#/bot/api/ai/quests/defs/druidspirit/journal.js';

const OPENING = "@str@After talking to Drezel in the temple of Saradomin I've|@str@agreed to look for a Druid called Filliman Tarlock.|";
const SPIRIT_FOUND = "@str@I've found a spirit in the swamp which I think might be|@str@Filliman Tarlock.|";
const GHOSTSPEAK = "@str@I've communicated with Filliman using the amulet of|@str@ghostspeak.|";
const CONVINCED = "@str@I managed to convince Filliman that he's a ghost.|@str@Filliman is looking for his journal to help him plan what his|@str@next step is.|";
const GAVE_JOURNAL = "@str@I've given Filliman his journal. I wonder what he plans to do|@str@now?|";
const AGREED = "@str@I've agreed to help Filliman become a nature spirit.|@str@I need to find 'something from nature', 'something of|@str@faith' and 'something of the spirit-to-become freely given'.|";
const GOT_SPELL = "@str@Filliman gave me a 'bloom' spell to cast in the swamp.|@str@With the bloom spell I can collect 'Something of nature.'|";
const BLESSED = "@str@I've been blessed at the temple by Drezel.|";
const CAST = "@str@I've cast the bloom spell in the swamp.|";
const FUNGI = '@str@I collected a Mort Myre Fungi.|';
const RITUAL = '@str@I managed to get all the required items that Filliman|@str@asked for.|'
    + '@str@He says that he can cast the spell now which will transform|@str@him into a Nature Spirit.|';
const BEFORE_RITUAL = OPENING + SPIRIT_FOUND + GHOSTSPEAK + CONVINCED + GAVE_JOURNAL + AGREED + GOT_SPELL + BLESSED + CAST + FUNGI;
const ENTERED = BEFORE_RITUAL
    + '@str@I mannaged to get all the required items that Filliman|@str@asked for.|'
    + '@str@He says that he can cast the spell now which will transform|@str@him into a Nature Spirit.|'
    + '@str@I entered Fillimans grotto as he asked me to.|';
const TRANSFORMED = ENTERED
    + '@str@Filliman has turned into a nature spirit, it was an impressive|@str@transformation!|'
    + '@str@Filliman says he can help me to defeat the ghasts.|';
const SICKLE_BLESSED = TRANSFORMED + '@str@Filliman has blessed the silver sickle for me.|';
const SICKLE_CAST = SICKLE_BLESSED + '@str@I cast the bloom spell in the swamp.|';
const HARVESTED = SICKLE_CAST + '@str@I collected some bloomed items from the swamp.|';
const POUCH = HARVESTED + '@str@I collected some bloomed items from the swamp and put|@str@them into a druid pouch.|';
const GHAST1 = POUCH + '@str@The druid pouch made a ghast appear which I attacked and|@str@killed.|';

const stageOf = (text: string): number | undefined => parseDruidJournal(text)?.stage;

describe('nature spirit journal', () => {
    test('not started', () => {
        expect(stageOf('@dbl@I can start this quest by speaking to @dre@Drezel@dbl@ in the|@dre@Mausoleum@dbl@ beneath @dre@Paterdomus@dbl@.'))
            .toBe(NS_STAGE.NOT_STARTED);
    });

    test('started', () => {
        expect(stageOf(OPENING + '@dbl@I need to look for @dre@Filliman Tarlock@dbl@ in the @dre@Swamps@dbl@ of Mort|Myre.'))
            .toBe(NS_STAGE.STARTED);
    });

    test('failed talk', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + "@dbl@I can't really communicate with this @dre@spirit@dbl@."))
            .toBe(NS_STAGE.FAILED_TALK);
    });

    test('spoken to Filliman', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + GHOSTSPEAK
            + "@dbl@I think I need to convince this poor fellow @dre@Tarlock@dbl@ that he's|actually @dre@dead@dbl@!"))
            .toBe(NS_STAGE.SPOKEN_FILLIMAN);
    });

    test('shown the mirror', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + GHOSTSPEAK + CONVINCED
            + '@dbl@Perhaps I should try to help @dre@Filliman@dbl@ to find his @dre@journal@dbl@?'))
            .toBe(NS_STAGE.SHOWN_MIRROR);
    });

    test('given the journal', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + GHOSTSPEAK + CONVINCED + GAVE_JOURNAL
            + '@dre@Filliman@dbl@ might need @dre@my help@dbl@ with his @dre@plan@dbl@.'))
            .toBe(NS_STAGE.GIVEN_JOURNAL);
    });

    test('holds the bloom spell, not yet blessed', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + GHOSTSPEAK + CONVINCED + GAVE_JOURNAL + AGREED
            + "@dre@Filliman@dbl@ gave me a '@dre@bloom'@dbl@ spell but I need to be @dre@blessed@dbl@ at|the @dre@temple@dbl@ before I can cast it."))
            .toBe(NS_STAGE.RECEIVED_SPELL);
    });

    test('blessed', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + GHOSTSPEAK + CONVINCED + GAVE_JOURNAL + AGREED + GOT_SPELL + BLESSED
            + "@dbl@I need to collect '@dre@something of nature.@dbl@'"))
            .toBe(NS_STAGE.BLESSED);
    });

    test('cast the scroll', () => {
        expect(stageOf(OPENING + SPIRIT_FOUND + GHOSTSPEAK + CONVINCED + GAVE_JOURNAL + AGREED + GOT_SPELL + BLESSED + CAST
            + "@dbl@I need to collect '@dre@something of nature.@dbl@'"))
            .toBe(NS_STAGE.CASTED_SPELL);
    });

    test('holds the fungus, no stones fed', () => {
        const progress = parseDruidJournal(BEFORE_RITUAL
            + '@dbl@I have a @dre@Mort Myre Fungi@dbl@, I hope this is what @dre@Filliman|@dbl@wanted.|'
            + "@dbl@I need to find '@dre@Something with faith@dbl@'|"
            + "@dbl@I need to find :|'@dre@Something of the spirit-to-become freely given.@dbl@'");
        expect(progress?.stage).toBe(NS_STAGE.PICKED_FUNGI);
        expect(progress?.flags.has(NS_FLAG.NATURE)).toBe(false);
        expect(progress?.flags.has(NS_FLAG.SPIRIT)).toBe(false);
    });

    test('both stones fed shows as two flags at the same stage', () => {
        const progress = parseDruidJournal(BEFORE_RITUAL
            + "@str@The Mort Myre Fungi was absorbed into the nature stone|@str@I think I have collected 'something of nature.'|"
            + "@dbl@I need to find '@dre@Something with faith@dbl@'|"
            + '@str@The spell scroll was absorbed into the spirit stone I think I|@str@have collected \'something of spirit-to-become freely|@str@given.\'');
        expect(progress?.stage).toBe(NS_STAGE.PICKED_FUNGI);
        expect(progress?.flags.has(NS_FLAG.NATURE)).toBe(true);
        expect(progress?.flags.has(NS_FLAG.SPIRIT)).toBe(true);
    });

    test('ritual performed', () => {
        const progress = parseDruidJournal(BEFORE_RITUAL + RITUAL + '@dre@Filliman@dbl@ asked me to meet him in his @dre@grotto@dbl@.');
        expect(progress?.stage).toBe(NS_STAGE.PERFORMED_RITUAL);
        expect(progress?.flags.has(NS_FLAG.NATURE)).toBe(true);
        expect(progress?.flags.has(NS_FLAG.SPIRIT)).toBe(true);
    });

    test('entered the grotto', () => {
        expect(stageOf(ENTERED + '@dre@Filliman@dbl@ asked me to meet him in his @dre@grotto@dbl@.')).toBe(NS_STAGE.ENTERED_GROTTO);
    });

    test('transformed', () => {
        expect(stageOf(TRANSFORMED + '@dre@Filliman@dbl@ asked me to get a @dre@silver sickle@dbl@.')).toBe(NS_STAGE.FULL_TRANSFORM);
    });

    test('sickle blessed', () => {
        expect(stageOf(SICKLE_BLESSED + '@dbl@I need to use the @dre@sickle@dbl@ to make the swamp bloom.')).toBe(NS_STAGE.BLESSED_SICKLE);
    });

    test('bloomed with the sickle', () => {
        expect(stageOf(SICKLE_CAST + "@dre@Filliman@dbl@ said something about collecting '@dre@natures bounty@dbl@'."))
            .toBe(NS_STAGE.CASTED_SICKLE_BLOOM);
    });

    test('harvested', () => {
        expect(stageOf(HARVESTED + "@dre@Filliman@dbl@ said something about a '@dre@druid pouch@dbl@'.")).toBe(NS_STAGE.PICKED_SICKLE);
    });

    test('pouch filled', () => {
        expect(stageOf(POUCH + '@dre@Filliman@dbl@ asked me to kill @dre@three ghasts@dbl@.')).toBe(NS_STAGE.ADDED_POUCH);
    });

    test('one ghast down', () => {
        expect(stageOf(GHAST1 + "@dbl@I've killed @dre@one@dbl@ ghast, I have another @dre@two@dbl@ to kill."))
            .toBe(NS_STAGE.KILLED_GHAST1);
    });

    test('two ghasts down', () => {
        expect(stageOf(GHAST1 + "@str@I've killed two ghasts now.|@dbl@I've killed @dre@two@dbl@ ghasts, I have another @dre@one@dbl@ to kill."))
            .toBe(NS_STAGE.KILLED_GHAST2);
    });

    test('three ghasts down', () => {
        expect(stageOf(GHAST1 + "@str@I've killed two ghasts now.|@str@I've killed three ghasts now.|"
            + "@dbl@I should tell @dre@Filliman@dbl@ that I've killed the @dre@three ghasts@dbl@."))
            .toBe(NS_STAGE.KILLED_GHAST3);
    });

    test('complete', () => {
        expect(stageOf('@str@Drezel, a priest of Saradomin, asked me to look for the|@str@druid Filliman Tarlock.|@red@QUEST COMPLETE!'))
            .toBe(NS_STAGE.COMPLETE);
    });

    test('an unreadable page yields nothing rather than a wrong stage', () => {
        expect(parseDruidJournal('')).toBeUndefined();
    });

    test('journal lines arrive as an array too', () => {
        expect(parseDruidJournal([OPENING, '@dbl@I need to look for @dre@Filliman Tarlock@dbl@ in the @dre@Swamps@dbl@ of Mort|Myre.']))
            .toEqual({ stage: NS_STAGE.STARTED, flags: new Set() });
    });
});
