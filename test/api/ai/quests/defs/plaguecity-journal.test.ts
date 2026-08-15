import { describe, expect, test } from 'bun:test';
import { PC_ITEM, plagueArea } from '#/bot/api/ai/quests/defs/plaguecity/areas.js';
import { PC_STAGE, parsePlagueJournal } from '#/bot/api/ai/quests/defs/plaguecity/journal.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

const OPENING = "@str@I've spoken to Edmond, he's asked me to help find his|@str@daughter Elena.|";
const GASMASK = '@str@Alrena has given me a Gasmask to protect me from the|@str@plague while in West Ardougne.';
const DIGGING = "@str@I've spoken to Edmond about getting into West Ardougne.|";
const SOFT = "@str@I've softened the ground in Edmond's garden enough to dig.|";
const TUNNEL = "@str@I've dug a tunnel into the sewers.|";
const PIPE = "@str@I've managed to clear the way into West Ardougne.|";
const JETHICK = "@str@I've spoken to Jethick, he thinks Elena was staying with|@str@the Rehnison Family, in a timber house to the north of the|@str@city.|";
const MILLI = "@str@I've spoken to Milli about Elena, she says Elena was taken|@str@into one of the Plague Houses.|";
const CURE = '@str@Bravek might give me clearance if I make his Hangover|@str@Cure.|';
const WARRANT = "@str@I've given Bravek the Hangover Cure and he has given me|@str@a warrant to enter the plague House.|";

describe('plagueArea', () => {
    test('classifies every pocket the quest can strand the bot in', () => {
        expect(plagueArea(at(2616, 3332))).toBe('east');
        expect(plagueArea(at(2540, 3305))).toBe('west');
        expect(plagueArea(at(2529, 3331, 1))).toBe('upstairs');
        expect(plagueArea(at(2541, 9672))).toBe('cellar');
        expect(plagueArea(at(2530, 9703))).toBe('sewer');
        expect(plagueArea(at(2561, 9737))).toBe('sewer');
    });

    test('the plague house cellar is not swallowed by the sewer', () => {
        expect(plagueArea(at(2537, 9670))).toBe('cellar');
        expect(plagueArea(at(2535, 9719))).toBe('sewer');
    });

    test("Edmond's garden is east, one tile outside the West Ardougne wall", () => {
        expect(plagueArea(at(2566, 3331))).toBe('east');
        expect(plagueArea(at(2556, 3300))).toBe('west');
        expect(plagueArea(at(2557, 3300))).toBe('east');
    });

    test('a null tile is unknown, never a default area', () => {
        expect(plagueArea(null)).toBe('unknown');
        expect(plagueArea(undefined)).toBe('unknown');
    });
});

describe('plague city item names', () => {
    test('the engine names that differ from the wiki are recorded exactly', () => {
        expect(PC_ITEM.TURNIP_BOOK.name).toBe('Book');
        expect(PC_ITEM.SCRUFFY_NOTE.name).toBe('A scruffy note');
        expect(PC_ITEM.ELENA_KEY.name).toBe('A small key');
        expect(PC_ITEM.ARDOUGNE_SCROLL.name).toBe('A magic scroll');
        expect(PC_ITEM.PICTURE.name).toBe('Picture');
    });
});

describe('parsePlagueJournal', () => {
    test('not started', () => {
        expect(parsePlagueJournal('@dbl@I can start this quest by speaking to @dre@Edmond')?.stage)
            .toBe(PC_STAGE.NOT_STARTED);
    });

    test('started, before the berries reach Alrena', () => {
        expect(parsePlagueJournal([OPENING, '@dbl@I need to get some Dwellberries for @dre@Alrena'])?.stage)
            .toBe(PC_STAGE.STARTED);
    });

    test('the mask alone is stage 2 — the digging line has not appeared', () => {
        const p = parsePlagueJournal([OPENING, GASMASK, '@dbl@I need to talk to @dre@Edmond @dbl@about getting into @dre@West Ardougne']);
        expect(p?.stage).toBe(PC_STAGE.GASMASK);
    });

    test('stages 3 to 6 all read as the low end of the water block', () => {
        const p = parsePlagueJournal([OPENING, GASMASK, DIGGING, '@dbl@I need to use @dre@Water @dbl@to soften the ground']);
        expect(p?.stage).toBe(PC_STAGE.MUD_START);
    });

    test('softened soil outranks the digging line', () => {
        expect(parsePlagueJournal([OPENING, GASMASK, DIGGING, SOFT, '@dbl@Now I need to dig a tunnel'])?.stage)
            .toBe(PC_STAGE.MUD_SOFT);
    });

    test('the tunnel, the tied rope and the open pipe each outrank the block below', () => {
        expect(parsePlagueJournal([SOFT, TUNNEL])?.stage).toBe(PC_STAGE.TUNNEL);
        expect(parsePlagueJournal([SOFT, TUNNEL, "@dbl@I've tied a rope to the sewer grill but I need help"])?.stage)
            .toBe(PC_STAGE.ROPE_TIED);
        expect(parsePlagueJournal([SOFT, TUNNEL, PIPE])?.stage).toBe(PC_STAGE.PIPE_OPEN);
    });

    test('stages 20 and 21 both read as SHOWN_PICTURE — the book in the pack tells them apart', () => {
        expect(parsePlagueJournal([PIPE, JETHICK])?.stage).toBe(PC_STAGE.SHOWN_PICTURE);
    });

    test('the parents line is stage 22 and Milli is stage 23', () => {
        expect(parsePlagueJournal([JETHICK, "@dbl@The @dre@Rehnisons' daughter Milli @dbl@may have seen @dre@Elena."])?.stage)
            .toBe(PC_STAGE.SPOKEN_PARENTS);
        expect(parsePlagueJournal([JETHICK, MILLI, '@dbl@I need to get access to the @dre@Plague House'])?.stage)
            .toBe(PC_STAGE.SPOKEN_MILLI);
    });

    test('stages 24 and 25 both read as NEED_CLEARANCE', () => {
        expect(parsePlagueJournal([MILLI, '@dbl@I need clearance from either the @dre@Head Mourner @dbl@or @dre@Bravek'])?.stage)
            .toBe(PC_STAGE.NEED_CLEARANCE);
    });

    test('the recipe, the warrant and the rescue each move the stage on', () => {
        expect(parsePlagueJournal([MILLI, CURE, '@dbl@I need to bring @dre@Bravek @dbl@the @dre@Hangover Cure'])?.stage)
            .toBe(PC_STAGE.SPOKEN_BRAVEK);
        expect(parsePlagueJournal([CURE, WARRANT])?.stage).toBe(PC_STAGE.CURED_BRAVEK);
        expect(parsePlagueJournal([WARRANT, "@str@I've freed Elena from the Plague House.|"])?.stage)
            .toBe(PC_STAGE.FREED_ELENA);
    });

    test('complete', () => {
        expect(parsePlagueJournal([WARRANT, "@str@I've freed Elena from the Plague House.|", '@red@QUEST COMPLETE!'])?.stage)
            .toBe(PC_STAGE.COMPLETE);
    });

    test('unrecognised journal text yields undefined, never a default stage', () => {
        expect(parsePlagueJournal(['something else entirely'])).toBeUndefined();
    });
});
