import { describe, expect, test } from 'bun:test';

import { TB_LUBUFU, TB_TAMAYU, TB_TINSAY } from '#/bot/api/ai/quests/defs/tbwt/areas.js';
import { parseTbwtJournal, TB_FLAG } from '#/bot/api/ai/quests/defs/tbwt/journal.js';

const HEADER = [
    '@str@I have found the three sons of Timfraku:|',
    '@str@Tamayu|@str@Tinsay|@str@Tiadeche|',
    '@dbl@I need to convince them to return to the village.||'
];

const TIADECHE_WAITING = [
    '@dre@Tiadeche:|',
    '@dbl@He will only return to the village once he has caught a|@dre@Karambwan@dbl@.||'
];

const TIADECHE_MANUAL = [
    '@dre@Tiadeche:|',
    '@str@He has successfully caught a Karambwan.|',
    '@dbl@I must take a @dre@Karambwan vessel@dbl@ to @dre@Tinsay@dbl@ and retrieve @dre@crafting instructions@dbl@ for @dre@Tiadeche@dbl@.||'
];

const LUBUFU_BASE = [
    '@dre@Lubufu:|',
    '@str@Lubufu is a crochety old fisherman just south of|@str@Brimhaven.|',
    '@str@He appears to have a local monopoly over the sale of|@str@Karambwan.||'
];

const value = (flags: Set<string>, name: string): number =>
    Number([...flags].find(f => f.startsWith(`${name}:`))?.split(':')[1]);

describe('tbwt journal', () => {
    test('a page that never rendered is not a quest at zero', () => {
        expect(parseTbwtJournal([])).toBeUndefined();
        expect(parseTbwtJournal(['@dbl@I can start this quest by speaking to @dre@Timfraku@dbl@.'])).toBeUndefined();
    });

    test('the opening brothers page reads every sub-stage at once', () => {
        const flags = parseTbwtJournal([
            ...HEADER,
            ...TIADECHE_WAITING,
            '@dre@Tinsay:|',
            '@dbl@He requires @dre@banana in Karamja rum@dbl@ to repair the tribal statue||',
            '@dre@Tamayu:|',
            '@dbl@He will only return to the village once he has slain @dre@Shaikahan@dbl@.||',
            ...LUBUFU_BASE,
            '@str@Lubufu has difficulty collecting bait, due to his age. I have|@str@offered to help collect bait. Lubufu has accepted.|',
            '@dbl@I need to give Lubufu 20 Karambwanji.||'
        ])!;
        expect(value(flags, TB_FLAG.TINSAY)).toBe(TB_TINSAY.FETCH_RUM);
        expect(value(flags, TB_FLAG.TAMAYU)).toBe(TB_TAMAYU.SLAY_SHAIKAHAN);
        expect(value(flags, TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.FETCH_KARAMBWANJI);
    });

    // Why: "Nothing of interest." is the intro line for three different brothers, so a marker only counts inside its own heading.
    test('an intro line is scoped to the brother whose heading it sits under', () => {
        const flags = parseTbwtJournal([
            ...HEADER,
            ...TIADECHE_WAITING,
            '@dre@Tinsay:|',
            'Nothing of interest.||',
            '@dre@Tamayu:|',
            '@dbl@He will only return to the village once he has slain @dre@Shaikahan@dbl@.||'
        ])!;
        expect(value(flags, TB_FLAG.TINSAY)).toBe(TB_TINSAY.INTRO);
        expect(value(flags, TB_FLAG.TAMAYU)).toBe(TB_TAMAYU.SLAY_SHAIKAHAN);
        expect(value(flags, TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.UNKNOWN);
    });

    test('later Tinsay stages re-print the earlier lines and still read as the latest', () => {
        const page = (extra: string[]): Set<string> =>
            parseTbwtJournal([...HEADER, ...TIADECHE_WAITING, '@dre@Tinsay:|', ...extra])!;

        const given = '@str@I have given him sliced banana in Karamja rum.|';
        const sandwich = '@str@I have given him a seaweed in monkey skin sandwich.|';
        expect(value(page([given]), TB_FLAG.TINSAY)).toBe(TB_TINSAY.GIVEN_RUM);
        expect(value(page([
            given,
            '@dbl@He requires a @dre@seaweed in monkey skin sandwich to repair @dre@the tribal statue with.||'
        ]), TB_FLAG.TINSAY)).toBe(TB_TINSAY.FETCH_SANDWICH);
        expect(value(page([given, sandwich]), TB_FLAG.TINSAY)).toBe(TB_TINSAY.GIVEN_SANDWICH);
        expect(value(page([
            given,
            sandwich,
            '@dbl@He requires @dre@burnt Jogre bones marinated in Karambwanji to ... repair the tribal statue with?||'
        ]), TB_FLAG.TINSAY)).toBe(TB_TINSAY.FETCH_BONES);
        expect(value(page([
            given,
            sandwich,
            '@str@I have given him a burnt Jogre bones marinated in|@str@Karambwanji paste.||'
        ]), TB_FLAG.TINSAY)).toBe(TB_TINSAY.COMPLETE);
    });

    test("Tamayu's two hunt preconditions are journal-visible", () => {
        const flags = parseTbwtJournal([
            ...HEADER,
            ...TIADECHE_MANUAL,
            '@dre@Tamayu:|',
            '@dbl@He will only return to the village once he has slain @dre@Shaikahan@dbl@.|',
            '@dbl@He appears to be having difficulty in the hunt.||',
            "@str@I have increased his agility to match the Shaikahan's.|",
            '@str@I have give him a stronger and Karambwan poisoned spear.||'
        ])!;
        expect(value(flags, TB_FLAG.TAMAYU)).toBe(TB_TAMAYU.WATCHED_CUTSCENE);
        expect(flags.has(TB_FLAG.AGILITY)).toBe(true);
        expect(flags.has(TB_FLAG.SPEAR)).toBe(true);
    });

    test('a watched hunt with neither gift given carries neither flag', () => {
        const flags = parseTbwtJournal([
            ...HEADER,
            ...TIADECHE_WAITING,
            '@dre@Tamayu:|',
            '@dbl@He will only return to the village once he has slain @dre@Shaikahan@dbl@.|',
            '@dbl@He appears to be having difficulty in the hunt.||'
        ])!;
        expect(value(flags, TB_FLAG.TAMAYU)).toBe(TB_TAMAYU.WATCHED_CUTSCENE);
        expect(flags.has(TB_FLAG.AGILITY)).toBe(false);
        expect(flags.has(TB_FLAG.SPEAR)).toBe(false);
    });

    test('a slain Shaikahan implies both gifts, whatever the page states', () => {
        const flags = parseTbwtJournal([
            ...HEADER,
            ...TIADECHE_MANUAL,
            '@str@Tamayu:|',
            '@str@Tamayu has slain the Shaikahan!||'
        ])!;
        expect(value(flags, TB_FLAG.TAMAYU)).toBe(TB_TAMAYU.COMPLETE);
        expect(flags.has(TB_FLAG.AGILITY)).toBe(true);
        expect(flags.has(TB_FLAG.SPEAR)).toBe(true);
    });

    test('the Lubufu ladder reads from first offer to apprenticeship', () => {
        const page = (extra: string[]): Set<string> => parseTbwtJournal([...HEADER, ...LUBUFU_BASE, ...extra])!;
        expect(value(page([]), TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.INITIAL_OPS);
        expect(value(page([
            '@dbl@Lubufu has difficulty collecting bait, due to his age. I have offered to help collect bait.||'
        ]), TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.OFFERED_TO_HELP);
        expect(value(page([
            '@str@I have given Lubufu 20 Karambwanji.||'
        ]), TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.GIVEN_KARAMBWANJI);
        expect(value(page([
            '@str@I have given Lubufu 20 Karambwanji.||',
            '@dbl@Lubufu has offered to train me as his apprentice.||'
        ]), TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.OFFERED_APPRENTICE);
        expect(value(page([
            '@str@I have given Lubufu 20 Karambwanji.||',
            '@str@Lubufu has offered to train me as his apprentice.|',
            "@str@I have accepted Lubufu's offer.||"
        ]), TB_FLAG.LUBUFU)).toBe(TB_LUBUFU.COMPLETE);
    });
});
