import { describe, expect, test } from 'bun:test';
import { MC_FLAG, MC_STAGE, parseDwarfCannonJournal } from '#/bot/api/ai/quests/defs/dwarfcannon/journal.js';

const INTRO =
    '@str@I have spoken to the Commander, he recruited me|@str@into the Black Guard and asked me to help the dwarves.||';

describe('parseDwarfCannonJournal', () => {
    test('not started', () => {
        const text =
            '@dbl@I can start this quest by speaking to the @dre@Commander of the Black Watch@dbl@. He is defending an area @dre@north-west of the Fishing Guild@dbl@ against @dre@goblin@dbl@ attack.|';
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.NOT_STARTED);
    });

    test('railings outstanding', () => {
        const text =
            INTRO
            + '@dbl@My first task is to @dre@fix the broken railings@dbl@ in the dwarves defensive perimeter.';
        const progress = parseDwarfCannonJournal(text)!;
        expect(progress.stage).toBe(MC_STAGE.RAILINGS);
        expect(progress.flags.has(MC_FLAG.RAILINGS_DONE)).toBe(false);
    });

    test('railings all fixed still reads stage 1, with the flag', () => {
        const text =
            INTRO + '@str@I have repaired all the broken railings,|@dbl@I should report back to the Commander.';
        const progress = parseDwarfCannonJournal(text)!;
        expect(progress.stage).toBe(MC_STAGE.RAILINGS);
        expect(progress.flags.has(MC_FLAG.RAILINGS_DONE)).toBe(true);
    });

    test('guard tower outranks the railings line it also carries', () => {
        const text =
            INTRO
            + '@str@I have repaired all the broken railings,|@dbl@The Commander has asked me to check up on his guards at @dre@the watchtower@dbl@ to the South of his camp.';
        const progress = parseDwarfCannonJournal(text)!;
        expect(progress.stage).toBe(MC_STAGE.GUARD_TOWER);
        expect(progress.flags.has(MC_FLAG.HAS_REMAINS)).toBe(false);
    });

    test('remains in the pack', () => {
        const text =
            INTRO
            + '@str@I went to the watchtower where I found some dwarf|@str@remains.|@dbl@I should take them back to @dre@the Commander@dbl@.';
        const progress = parseDwarfCannonJournal(text)!;
        expect(progress.stage).toBe(MC_STAGE.GUARD_TOWER);
        expect(progress.flags.has(MC_FLAG.HAS_REMAINS)).toBe(true);
    });

    test('goblin cave', () => {
        const text =
            INTRO + '@str@I gave the remains to the Commander.|@dbl@He sent me to find the @dre@Goblin base@dbl@.';
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.GOBLIN_CAVE);
    });

    test('find the child', () => {
        const text =
            INTRO + "@str@I found the Goblin's base.|@dbl@Next I need to find the @dre@Dwarf child@dbl@.";
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.FIND_CHILD);
    });

    test('child rescued', () => {
        const text =
            INTRO
            + '@str@I have rescued the dwarf child and sent him back to the|@str@Commander.|@dbl@I need to @dre@speak to the Commander@dbl@ again.';
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.CHILD_RESCUED);
    });

    test('stages 6 and 7 are one branch', () => {
        const text = INTRO + '@dbl@The Commander has asked me to @dre@fix the multicannon@dbl@.';
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.FIX_CANNON);
    });

    test('cannon repaired', () => {
        const text =
            INTRO
            + "@str@I've fixed the broken multicannon,|@dbl@I need to @dre@speak to the Commander@dbl@ again.";
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.CANNON_FIXED);
    });

    test('sent to Nulodion', () => {
        const text =
            INTRO
            + '@dbl@The Commander asked me to find @dre@Nulodion the Cannon Engineer@dbl@, he needs to know what @dre@ammunition the multicannon@dbl@ fires.';
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.SEE_NULODION);
    });

    test('carrying the mould and notes back', () => {
        const text =
            INTRO
            + "@str@I've spoken to Nulodion,|@str@He gave me an ammo mould and notes,|@dbl@I need to @dre@speak to the Commander@dbl@ again.";
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.RETURN_NOTES);
    });

    test('complete', () => {
        const text =
            INTRO
            + '@str@I fixed the cannon and got a mould for the Commander.|@dbl@I can now @dre@buy a multicannon@dbl@ from @dre@Nulodion@dbl@ as a reward.||@red@QUEST COMPLETE!';
        expect(parseDwarfCannonJournal(text)?.stage).toBe(MC_STAGE.COMPLETE);
    });

    test('unrecognised text is undefined', () => {
        expect(parseDwarfCannonJournal('nothing here')).toBeUndefined();
    });
});
