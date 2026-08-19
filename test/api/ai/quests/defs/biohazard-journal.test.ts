import { describe, expect, test } from 'bun:test';
import { BIO_STAGE, parseBiohazardJournal } from '#/bot/api/ai/quests/defs/biohazard/journal.js';

/** The journal appends, so every case carries the lines every earlier stage wrote. */
const SPOKEN_ELENA = "@str@I've spoken to Elena, the Mourners stole her distillator|";
const SPOKEN_JERICO = '|@str@I\'ve spoken to Jerico about getting into West Ardougne|';
const CROSSED = '|@str@I\'ve crossed the wall into West Ardougne'
    + '|@str@Omart and Kilron will stay to help me out again|';
const HUNTING = "|@dbl@Somewhere in this city is @dre@Elena's distillator @dbl@- I must find|it and return it to her|";
const RETURNED = "|@str@I've found Elena's Distillator and returned it to her|";
const CHEMICALS = '|@str@Elena gave me some chemicals to take to Guidor|';
const DELIVERED = "|@str@I've given all the items to Guidor|";

const page = (...lines: string[]): string => lines.join('');

describe('biohazard journal parser', () => {
    test('the opening page is not started', () => {
        const text = '@dbl@I can start this quest by speaking to @dre@Elena @dbl@who is in @dre@East|Ardougne';
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.NOT_STARTED);
    });

    test('a quest that has only met Elena needs Jerico', () => {
        const text = page(SPOKEN_ELENA, '|@dbl@I need to talk to @dre@Jerico @dbl@about getting over the wall and|into @dre@West Ardougne');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.STARTED);
    });

    test('Jerico names Omart', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, '|@dre@Omart @dbl@will be able to get me over the wall', '|@dbl@He\'s waiting at the @dre@South @dbl@end of the wall');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.SPOKEN_JERICO);
    });

    test('the thrown seed reads past the Jerico line', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, "|@dbl@I've chucked some birdfeed onto the Watch Tower");
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.USED_BIRDFEED);
    });

    test('the flapping pigeons read past the seed', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, '|@dbl@The Watch Tower is now surrounded by flapping pigeons!', '|@dbl@Maybe I can sneak over the wall while the mourners are|distracted');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.RELEASED_PIGEONS);
    });

    test('crossing the wall reads past everything before it', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, HUNTING);
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.CLIMBED_LADDER);
    });

    test('the poisoned stew outranks the crossing line it sits under', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, HUNTING, "|@dbl@I have rather unkindly poisoned the mourners' stew by|putting rotten apples into it!");
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.POISONED_STEW);
    });

    test('finding the distillator outranks the poisoned stew', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, "|@str@I managed to find Elena's distillator", '|@dbl@Now I can return the @dre@distillator @dbl@to @dre@Elena');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.FOUND_DISTILLATOR);
    });

    test('a mislaid distillator still reads as found, not as lost progress', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, "|@str@I managed to find Elena's distillator", '|@dbl@I seem to have mislaid the @dre@distillator');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.FOUND_DISTILLATOR);
    });

    test("Elena's shopping list is the handed-over stage", () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, RETURNED, "|@dbl@Elena's asked me to take the following items to @dre@Guidor @dbl@who|lives in @dre@Varrock", '|@dre@Plague Sample @dbl@from @dre@Elena');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.GIVEN_DISTILLATOR);
    });

    test('the Varrock guards line is the chemist stage', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, RETURNED, CHEMICALS, '|@dbl@The Varrock guards are out looking for someone carrying|suspicious materials.');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.SPOKEN_CHEMIST);
    });

    test("Guidor's findings outrank the delivery line under them", () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, RETURNED, CHEMICALS, DELIVERED, "|@dre@Guidor's @dbl@findings were very interesting", '|@dbl@Apparently there is no @dre@Plague@dbl@!');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.FOUND_SECRET);
    });

    test('the king line outranks the findings under it', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, RETURNED, CHEMICALS, DELIVERED, "|@str@I've told Elena Guidor's findings, she was horrified!|", '|@dbl@I need to confront the @dre@King of East Ardougne');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.REPORTED_ELENA);
    });

    test('a finished quest reads complete', () => {
        const text = page(SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, RETURNED, CHEMICALS, DELIVERED, "|@str@I've spoken to King Lathas, he admits the Plague was fake!|", '@red@QUEST COMPLETE!');
        expect(parseBiohazardJournal(text)?.stage).toBe(BIO_STAGE.COMPLETE);
    });

    test('an unrecognised page is undefined rather than stage zero', () => {
        expect(parseBiohazardJournal('@dbl@Something else entirely')).toBeUndefined();
    });

    test('an array of lines parses the same as the joined page', () => {
        const lines = [SPOKEN_ELENA, SPOKEN_JERICO, CROSSED, HUNTING];
        expect(parseBiohazardJournal(lines)?.stage).toBe(BIO_STAGE.CLIMBED_LADDER);
    });
});
