import { describe, expect, test } from 'bun:test';
import { DRAGON_STAGE, parseDragonJournal } from '#/bot/api/ai/quests/defs/dragonslayer/journal.js';

// Why: lines are verbatim from `dragon_journal.rs2`, so the parser is tested against what the engine renders.
const INTRO = '@str@The Guildmaster of the Champions\' Guild said his friend|@str@Oziach could help me with a Rune Plate mail body.|';
const OZIACH_SELLS = '@dre@Oziach@dbl@ will sell me @dre@Rune Plate Mail@dbl@ if I can prove myself|worthy by killing the @dre@Dragon Elvarg@dbl@ who lives on @dre@Crandor@dbl@|';
const NEEDS_BRIEFING = '@dbl@I should return to @dre@Oziach@dbl@ for more detailed instructions.';
const OBJECTIVES = '@dbl@To defeat the dragon I will need to find a @dre@map@dbl@ to|Crandor, a @dre@ship@dbl@, a @dre@captain@dbl@ to take me there and some kind|@dbl@of @dre@protection@dbl@ against the dragon\'s breath.|';
const NEED_MELZAR = '@dbl@One-third of the map is in @dre@Melzar\'s Maze@dbl@, near|@dre@Rimmington@dbl@.|';
const NEED_ORACLE = '@dbl@One-third of the map is hidden, and only the @dre@Oracle@dbl@ on @dre@Ice|Mountain@dbl@ will know where it is.|';
const NEED_GOBLIN = '@dbl@One-third of the map was stolen by a @dre@goblin@dbl@ from the|@dre@Goblin Village@dbl@.|';
const GOT_MELZAR = '@str@I found the piece of the map that was hidden in Melzar\'s|@str@Maze.|';
const GOT_ORACLE = '@str@I found the piece of the map that was hidden in beneath Ice|@str@Mountain.|';
const GOT_GOBLIN = '@str@I found the piece of the map that the goblin, Wormbrain,|@str@stole.|';
const NEED_SHIELD = '@dbl@I should ask the @dre@Duke of Lumbridge@dbl@ for an @dre@anti-|dragonbreath shield@dbl@.|';
const GOT_SHIELD = '@str@The Duke of Lumbridge gave me an anti-dragonbreath|@str@shield.|';
const SHIP_FOR_SALE = '@dbl@I should see if there is a @dre@ship@dbl@ for sale in @dre@Port Sarim@dbl@.|';
const BOUGHT_SHIP = '@str@I bought a ship in Port Sarim called the Lady Lumbridge.|';
const NEEDS_REPAIR = '@dbl@My ship will need some repairs, using @dre@wooden planks@dbl@ and|@dre@steel nails@dbl@, before it is seaworthy again.|';
const REPAIRED = '@str@I have repaired my ship using wooden planks and steel|@str@nails.|';
const NEED_CAPTAIN = '@dbl@I still need to find a @dre@captain@dbl@ for my ship.|';
const NED_HIRED = '@str@Captain Ned from Draynor Village has agreed to sail the|@str@ship to Crandor for me.|';
const SET_SAIL = '@dbl@Now I should go to my ship in @dre@Port Sarim@dbl@ and set sail for|@dre@Crandor@dbl@!';
const KILL_DRAGON = '@dbl@Now all I need to do is kill the @dre@dragon@dbl@!';
const ORACLE_RHYME = '@dbl@I asked the @dre@Oracle@dbl@ about the lost map piece, and she told|me the following rhyme:|@dre@The map\'s behind a door below,|but entering is rather tough.|';
const SECRET_PASSAGE = '@str@Now that I have found the secret passage leading from|@str@Karamja to Crandor I don\'t need to worry about having a|@str@seaworthy ship or a captain fit to sail it anymore.|';

const stageOf = (text: string): number | undefined => parseDragonJournal(text)?.stage;
const flagsOf = (text: string): ReadonlySet<string> => parseDragonJournal(text)?.flags ?? new Set();

describe('parseDragonJournal stages', () => {
    test('not started', () => {
        const text = '@dbl@I can start this quest by speaking to the @dre@Guildmaster@dbl@ in|the @dre@Champions\' Guild@dbl@, south-west of Varrock.|';
        expect(stageOf(text)).toBe(DRAGON_STAGE.NOT_STARTED);
    });

    test('spoken to the guildmaster', () => {
        const text = INTRO + '@dbl@I should speak to @dre@Oziach@dbl@, who lives by the cliffs to the|west of @dre@Edgeville@dbl@.';
        expect(stageOf(text)).toBe(DRAGON_STAGE.SPOKEN_GUILDMASTER);
    });

    test('spoken to Oziach but not yet briefed', () => {
        const text = INTRO + OZIACH_SELLS + NEEDS_BRIEFING;
        expect(stageOf(text)).toBe(DRAGON_STAGE.SPOKEN_OZIACH);
        expect(flagsOf(text).has('needs-briefing')).toBe(true);
    });

    test('briefed, gathering map pieces', () => {
        const text = INTRO + OZIACH_SELLS + OBJECTIVES + NEED_MELZAR + NEED_ORACLE + NEED_GOBLIN + NEED_SHIELD + SHIP_FOR_SALE;
        expect(stageOf(text)).toBe(DRAGON_STAGE.SPOKEN_OZIACH);
        expect(flagsOf(text).has('needs-briefing')).toBe(false);
    });

    test('ship bought but not repaired', () => {
        const text = INTRO + OZIACH_SELLS + OBJECTIVES + GOT_MELZAR + GOT_ORACLE + GOT_GOBLIN + GOT_SHIELD + BOUGHT_SHIP + NEEDS_REPAIR + NEED_CAPTAIN;
        expect(stageOf(text)).toBe(DRAGON_STAGE.BOUGHT_SHIP);
    });

    test('ship repaired, still no captain', () => {
        const text = INTRO + OZIACH_SELLS + OBJECTIVES + GOT_MELZAR + GOT_ORACLE + GOT_GOBLIN + GOT_SHIELD + BOUGHT_SHIP + REPAIRED + NEED_CAPTAIN;
        expect(stageOf(text)).toBe(DRAGON_STAGE.REPAIRED_SHIP);
    });

    test('Ned hired and the map handed over', () => {
        const text = INTRO + OZIACH_SELLS + GOT_MELZAR + GOT_ORACLE + GOT_GOBLIN + GOT_SHIELD + BOUGHT_SHIP + REPAIRED + NED_HIRED + SET_SAIL;
        expect(stageOf(text)).toBe(DRAGON_STAGE.NED_GIVEN_MAP);
    });

    test('landed on Crandor', () => {
        const text = INTRO + OZIACH_SELLS + GOT_MELZAR + GOT_ORACLE + GOT_GOBLIN + GOT_SHIELD + NED_HIRED + REPAIRED + KILL_DRAGON;
        expect(stageOf(text)).toBe(DRAGON_STAGE.SAILED_TO_CRANDOR);
    });

    test('complete', () => {
        expect(stageOf(INTRO + GOT_MELZAR + '@red@QUEST COMPLETE!')).toBe(DRAGON_STAGE.COMPLETE);
    });

    test('an unrecognised journal yields no stage', () => {
        expect(parseDragonJournal('@dbl@Something else entirely.')).toBeUndefined();
    });
});

describe('parseDragonJournal flags', () => {
    test('tracks each map piece independently', () => {
        const none = flagsOf(INTRO + OBJECTIVES + NEED_MELZAR + NEED_ORACLE + NEED_GOBLIN + SHIP_FOR_SALE);
        expect(none.has('map-melzar')).toBe(false);
        expect(none.has('map-ice')).toBe(false);
        expect(none.has('map-wormbrain')).toBe(false);

        const some = flagsOf(INTRO + OBJECTIVES + GOT_MELZAR + NEED_ORACLE + GOT_GOBLIN + SHIP_FOR_SALE);
        expect(some.has('map-melzar')).toBe(true);
        expect(some.has('map-ice')).toBe(false);
        expect(some.has('map-wormbrain')).toBe(true);
    });

    test('separates having the shield from being told to fetch it', () => {
        expect(flagsOf(INTRO + NEED_SHIELD + SHIP_FOR_SALE).has('has-shield')).toBe(false);
        expect(flagsOf(INTRO + GOT_SHIELD + SHIP_FOR_SALE).has('has-shield')).toBe(true);
    });

    test('notices the oracle rhyme', () => {
        expect(flagsOf(INTRO + OBJECTIVES + NEED_ORACLE + SHIP_FOR_SALE).has('asked-oracle')).toBe(false);
        expect(flagsOf(INTRO + OBJECTIVES + ORACLE_RHYME + SHIP_FOR_SALE).has('asked-oracle')).toBe(true);
    });

    test('notices the repaired ship and the hired captain', () => {
        const text = INTRO + BOUGHT_SHIP + REPAIRED + NED_HIRED + SET_SAIL;
        expect(flagsOf(text).has('ship-repaired')).toBe(true);
        expect(flagsOf(text).has('ned-hired')).toBe(true);
    });

    test('notices the Karamja passage once it replaces the ship', () => {
        const text = INTRO + GOT_MELZAR + GOT_ORACLE + GOT_GOBLIN + SECRET_PASSAGE + KILL_DRAGON;
        expect(stageOf(text)).toBe(DRAGON_STAGE.SAILED_TO_CRANDOR);
        expect(flagsOf(text).has('secret-passage')).toBe(true);
    });
});
