import { describe, expect, test } from 'bun:test';

import { HD_STAGE } from '#/bot/api/ai/quests/defs/horror/areas.js';
import { HD_FLAG, parseHorrorJournal } from '#/bot/api/ai/quests/defs/horror/journal.js';

/** Every page here is verbatim from a live client — see `e2e/horror-journal-dump.ts`. */
const NOT_STARTED = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@dbl@I can start this quest by speaking to @dre@Larrissa@dbl@ at the',
    '@dbl@@dre@Lighthouse@dbl@ to the @dre@North@dbl@ of the @dre@Barbarian Outpost@dbl@.',
    '@dbl@@dbl@To complete this quest I need:',
    '@dbl@@dre@Level 35 agility',
    '@dre@Level 13 or higher magic will be an advantage',
    '@dre@I must also be able to defeat strong level 100 enemies'
];

// Why: `~quest_journal` word-wraps through `split_init` and re-emits the active tags per line, so `@str@@bla@` appears only in client output, never in horror_journal.rs2.
const STARTED_NOTHING_DONE = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@dbl@Larrissa is very worried about her boyfriend Jossik.',
    '@dbl@I need to @dre@repair the bridge@dbl@ leading to Rellekka.',
    '@dbl@I also need to get the @dre@lighthouse key@dbl@ from her cousin',
    '@dre@@dre@Gunnjorn@dbl@.'
];

const STARTED_BRIDGE_AND_KEY = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@dbl@Larrissa is very worried about her boyfriend Jossik.',
    '@str@@bla@I need to repair the bridge leading to Rellekka.',
    '@dbl@I also need to use the key I got from Gunnjorn to enter',
    '@dbl@@dbl@the lighthouse.'
];

const BRIDGE_AND_KEY_DONE = [
    'Close Window',
    '@dre@Horror from the Deep',
    '@str@I repaired the bridge leading to Rellekka and got a key',
    '@str@from Gunnjorn so I could enter the lighthouse.'
];

const INSIDE_LIGHTHOUSE = [
    ...BRIDGE_AND_KEY_DONE,
    '@dbl@Now I need to find some way of @dre@fixing@dbl@ the @dre@lighthouse @dre@lamp@dbl@.'
];

const INSIDE_PART_REPAIRED = [
    ...BRIDGE_AND_KEY_DONE,
    '@str@I have fixed the lighthouse lens.',
    '@str@I have re-tarred the lighthouse torch.',
    '@dbl@Now I need to find some way of @dre@fixing@dbl@ the @dre@lighthouse @dre@lamp@dbl@.'
];

const LIGHT_REPAIRED = [
    ...BRIDGE_AND_KEY_DONE,
    '@str@I managed to repair the lighthouse light with some molten',
    '@str@glass, some swamp tar and a tinderbox.',
    '@dbl@I must @dre@search this place@dbl@ and find out what has happened to',
    "@dbl@@dbl@Larrissa's boyfriend @dre@Jossik@dbl@!"
];

const FOUND_JOSSIK = [
    ...BRIDGE_AND_KEY_DONE,
    '@str@I managed to repair the lighthouse light with some molten',
    '@str@glass, some swamp tar and a tinderbox.',
    '@str@I found Jossik in an underground cavern, behind a strange',
    '@str@wall where he had been attacked by some sea @str@creatures.',
    '@dbl@I must defeat these sea monsters to save him!'
];

const COMPLETE = [
    '@str@I travelled to an isolated lighthouse north of the Barbarian|',
    '@str@outpost, to find a Fremennik girl called Larrissa locked|',
    '@str@outside, and worried about her boyfriend Jossik.|',
    "@str@I recovered a spare key from Larrissa's cousin Gunnjorn and ",
    '@str@repaired the bridge to Rellekka with some planks.|',
    '@str@After I killed some strange sea monsters, I managed to|',
    '@str@get Jossik out of the cavern and back to the lighthouse.|||',
    '@red@QUEST COMPLETE!'
];

describe('Horror from the Deep journal', () => {
    test('reads the not-started page', () => {
        expect(parseHorrorJournal(NOT_STARTED)?.stage).toBe(HD_STAGE.NOT_STARTED);
    });

    test('reads a freshly started quest', () => {
        const progress = parseHorrorJournal(STARTED_NOTHING_DONE);
        expect(progress?.stage).toBe(HD_STAGE.STARTED);
        expect(progress?.flags.has(HD_FLAG.BRIDGE)).toBe(false);
        expect(progress?.flags.has(HD_FLAG.KEY)).toBe(false);
    });

    test('reads the bridge off the colour tag, not the words', () => {
        // Both branches print the same sentence; only @str@ against @dbl@ says
        // whether it is struck out, so this flag is read before tags are stripped.
        const progress = parseHorrorJournal(STARTED_BRIDGE_AND_KEY);
        expect(progress?.stage).toBe(HD_STAGE.STARTED);
        expect(progress?.flags.has(HD_FLAG.BRIDGE)).toBe(true);
        expect(progress?.flags.has(HD_FLAG.KEY)).toBe(true);
    });

    test('reads the lighthouse stage', () => {
        const progress = parseHorrorJournal(INSIDE_LIGHTHOUSE);
        expect(progress?.stage).toBe(HD_STAGE.ENTERED_LIGHTHOUSE);
        // The bridge line is gone by now, folded into one struck-out summary —
        // re-asserting it is what stops later stages reading it as unbuilt.
        expect(progress?.flags.has(HD_FLAG.BRIDGE)).toBe(true);
    });

    test('reads part-finished lamp work', () => {
        const progress = parseHorrorJournal(INSIDE_PART_REPAIRED);
        expect(progress?.stage).toBe(HD_STAGE.ENTERED_LIGHTHOUSE);
        expect(progress?.flags.has(HD_FLAG.GLASS)).toBe(true);
        expect(progress?.flags.has(HD_FLAG.TAR)).toBe(true);
        expect(progress?.flags.has(HD_FLAG.LIGHT)).toBe(false);
    });

    test('reads the repaired lighthouse', () => {
        const progress = parseHorrorJournal(LIGHT_REPAIRED);
        expect(progress?.stage).toBe(HD_STAGE.REPAIRED_LIGHTHOUSE);
        expect(progress?.flags.has(HD_FLAG.LIGHT)).toBe(true);
    });

    test('reads the stage after the junior dies', () => {
        expect(parseHorrorJournal(FOUND_JOSSIK)?.stage).toBe(HD_STAGE.DEFEATED_DAGJR);
    });

    test('reads the completed page', () => {
        expect(parseHorrorJournal(COMPLETE)?.stage).toBe(HD_STAGE.COMPLETE);
    });

    test('returns undefined for a page it does not recognise', () => {
        expect(parseHorrorJournal(['@dbl@Something else entirely.'])).toBeUndefined();
    });
});
