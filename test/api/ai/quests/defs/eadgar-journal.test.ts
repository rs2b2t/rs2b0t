import { describe, expect, test } from 'bun:test';
import { committed, eadgarZone, ER_ITEM } from '#/bot/api/ai/quests/defs/eadgar/areas.js';
import { EADGAR_FLAG, EADGAR_STAGE, parseEadgarJournal } from '#/bot/api/ai/quests/defs/eadgar/journal.js';
import { flagValue } from '#/bot/api/ai/quests/engine/types.js';

const at = (x: number, z: number, level = 0): { x: number; z: number; level: number } => ({ x, z, level });

// Lines lifted from content `eadgar_journal.rs2`; the journal keeps every earlier one struck through.
const OPENED = '@str@Sanfew asked me to find him some Goutweed.';
const COOK = '|@str@The Troll Cook will tell me how to find goutweed if I bring him|@str@a tasty human.';
const PLAN = '|@str@Mad Eadgar has a plan.';
const PARROT = '||@str@I got the parrot Eadgar wanted.';
const HIDDEN = '|@str@I hid the parrot under the rack in the Troll prison.';
const GAVE = '|@str@Eadgar wants to make a fake human to give the troll cook. I|@str@gave Eadgar everything he needed.';
const POTION = '|@str@I made the Troll potion and gave it to Mad Eadgar.';
const FETCHED = '|@str@I fetched the parrot back from the Troll prison rack';
const FAKE_MAN = " and|@str@gave it to Eadgar.||@str@I got Eadgar's fake man";
const BURNT = ' and gave it to the Troll Cook.|@str@The Troll Cook told me the key to the storeroom is in a|@str@fake bottom in the kitchen drawers.';
const UNLOCKED = "||@str@I've unlocked the storeroom!";

const NOT_STARTED =
    '@dbl@I can start this quest by speaking to @dre@Sanfew@dbl@ after|completing the @dre@Druidic Ritual@dbl@ quest in @dre@Taverley@dbl@. To complete|'
    + 'this quest I need @dre@Level 31 Herblore@dbl@. I also need to have|rescued @dre@Mad Eadgar@dbl@ from the @dre@Troll Stronghold';

const NEEDS_LIST =
    OPENED + COOK + PLAN + PARROT + HIDDEN
    + '||@dbl@Eadgar wants to make a @dre@fake human @dbl@to give the Troll Cook.|I still need to bring him:'
    + '@dre@|Logs|5 raw chickens|10 sheaves of grains|Some Dirty Clothes';

describe('parseEadgarJournal', () => {
    test.each<[string, number]>([
        [NOT_STARTED, EADGAR_STAGE.NOT_STARTED],
        [
            OPENED + '||@dbl@I need to find out where to get @dre@Goutweed - Mad Eadgar@dbl@ may|be able to help.',
            EADGAR_STAGE.STARTED
        ],
        [
            OPENED + '||@dbl@I need to find out where to get @dre@Goutweed - @dbl@I should ask the|@dre@Troll Cook.',
            EADGAR_STAGE.SPOKE_EADGAR
        ],
        [
            OPENED + COOK + '||@dbl@I need to get @dre@a tasty human@dbl@ for the @dre@Troll Cook. Mad Eadgar|@dbl@may be able to help.',
            EADGAR_STAGE.SPOKE_BURNTMEAT
        ],
        [
            OPENED + COOK + PLAN + '||@dbl@I need to bring Eadgar a @dre@parrot @dbl@from the @dre@Zoo',
            EADGAR_STAGE.NEEDS_PARROT
        ],
        [
            OPENED + COOK + PLAN + PARROT
            + '||@dbl@I need to @dre@hide the parrot@dbl@ somewhere it can hear what Trolls|expect humans to sound like.',
            EADGAR_STAGE.EXPLAINED_PLAN
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + "||@dbl@I should go and find out the rest of Mad Eadgar's plan.",
            EADGAR_STAGE.HID_PARROT
        ],
        [NEEDS_LIST, EADGAR_STAGE.NEEDS_ITEMS],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE
            + '|@dbl@I need to make a troll truth potion by putting @dre@dried, @dre@ground|troll thistle @dbl@in a @dre@potion of ranarr weed',
            EADGAR_STAGE.NEEDS_POTION
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION
            + '||@dbl@I need to fetch the parrot back from the @dre@prison rack',
            EADGAR_STAGE.NEEDS_PARROT_BACK
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + '.|@dbl@I should go tell Eadgar.',
            EADGAR_STAGE.GOT_PARROT_BACK
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + FAKE_MAN
            + '.|@dbl@I should give the fake man to the @dre@Troll cook',
            EADGAR_STAGE.GOT_FAKE_MAN
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + FAKE_MAN + BURNT
            + '||@dbl@I should get the @dre@key to the storeroom @dbl@and unlock it.',
            EADGAR_STAGE.GOT_BURNT_MEAT
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + FAKE_MAN + BURNT + UNLOCKED
            + '|@dbl@I should sneak in and get some @dre@goutweed',
            EADGAR_STAGE.UNLOCKED_STOREROOM
        ],
        [
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + FAKE_MAN + BURNT + UNLOCKED
            + '|@str@I snuck into the storeroom and got some goutweed. I gave|@str@ it to Sanfew and he taught me the Trollheim Teleport spell.'
            + '||@dre@QUEST COMPLETE!',
            EADGAR_STAGE.COMPLETE
        ]
    ])('maps journal text to stage %#', (text, stage) => {
        expect(parseEadgarJournal(text)?.stage).toBe(stage);
    });

    test('fails closed on journal text it does not recognise', () => {
        expect(parseEadgarJournal(["Eadgar's Ruse", 'Loading…'])).toBeUndefined();
    });

    // Why: every later entry keeps every struck-through line, so a phrase that first appears
    // at stage 60 is still in the text at stage 100 — the newest phrase has to win.
    test('the newest phrase wins over every earlier one it still carries', () => {
        const late = OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + FAKE_MAN + BURNT + UNLOCKED;
        expect(late).toContain('I hid the parrot under the rack');
        expect(late).toContain("I got Eadgar's fake man");
        expect(parseEadgarJournal(late)?.stage).toBe(EADGAR_STAGE.UNLOCKED_STOREROOM);
    });
});

describe("Eadgar's Ruse scarecrow needs", () => {
    test('reads the whole list at stage 70', () => {
        const progress = parseEadgarJournal(NEEDS_LIST);
        expect(progress?.stage).toBe(EADGAR_STAGE.NEEDS_ITEMS);
        expect(progress?.flags.has(EADGAR_FLAG.NEED_LOGS)).toBe(true);
        expect(progress?.flags.has(EADGAR_FLAG.NEED_CLOTHES)).toBe(true);
        expect(flagValue(progress, EADGAR_FLAG.NEED_CHICKENS)).toBe(5);
        expect(flagValue(progress, EADGAR_FLAG.NEED_GRAIN)).toBe(10);
    });

    test('reads a part-delivered list, singulars included', () => {
        const progress = parseEadgarJournal(
            OPENED + COOK + PLAN + PARROT + HIDDEN
            + '||@dbl@Eadgar wants to make a @dre@fake human @dbl@to give the Troll Cook.|I still need to bring him:'
            + '@dre@|1 raw chicken|1 sheaf of grain'
        );
        expect(progress?.flags.has(EADGAR_FLAG.NEED_LOGS)).toBe(false);
        expect(progress?.flags.has(EADGAR_FLAG.NEED_CLOTHES)).toBe(false);
        expect(flagValue(progress, EADGAR_FLAG.NEED_CHICKENS)).toBe(1);
        expect(flagValue(progress, EADGAR_FLAG.NEED_GRAIN)).toBe(1);
    });

    // Why: "a tasty human" and "the rack in the Troll prison" both sit above the list in the same
    // journal, and neither is anything the scarecrow still wants.
    test('reads the tail after the list header, never the struck-through history', () => {
        const progress = parseEadgarJournal(
            OPENED + COOK + PLAN + PARROT + HIDDEN
            + '||@dbl@Eadgar wants to make a @dre@fake human @dbl@to give the Troll Cook.|I still need to bring him:@dre@|Logs'
        );
        expect(progress?.flags.has(EADGAR_FLAG.NEED_LOGS)).toBe(true);
        expect(flagValue(progress, EADGAR_FLAG.NEED_CHICKENS)).toBeUndefined();
        expect(flagValue(progress, EADGAR_FLAG.NEED_GRAIN)).toBeUndefined();
        expect(progress?.flags.has(EADGAR_FLAG.NEED_CLOTHES)).toBe(false);
    });

    test('the made-potion and carried-goutweed lines are flags, not stages', () => {
        const withPotion = parseEadgarJournal(
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE
            + '|@dbl@I made the Troll potion. I should go give it to @dre@Mad @dre@Eadgar'
        );
        expect(withPotion?.stage).toBe(EADGAR_STAGE.NEEDS_POTION);
        expect(withPotion?.flags.has(EADGAR_FLAG.POTION_MADE)).toBe(true);

        const withGoutweed = parseEadgarJournal(
            OPENED + COOK + PLAN + PARROT + HIDDEN + GAVE + POTION + FETCHED + FAKE_MAN + BURNT + UNLOCKED
            + '|@str@I snuck into the storeroom and got some goutweed.|@dbl@I should bring this to @dre@Sanfew and collect my reward.'
        );
        expect(withGoutweed?.stage).toBe(EADGAR_STAGE.UNLOCKED_STOREROOM);
        expect(withGoutweed?.flags.has(EADGAR_FLAG.HAVE_GOUTWEED)).toBe(true);
    });
});

describe('eadgarZone', () => {
    test('classifies each leg of the route', () => {
        expect(eadgarZone(at(2893, 10074, 2))).toBe('cave');
        expect(eadgarZone(at(2890, 10086, 2))).toBe('cave');
        expect(eadgarZone(at(2844, 10057, 1))).toBe('stronghold');
        expect(eadgarZone(at(2856, 10075))).toBe('stronghold');
        expect(eadgarZone(at(2891, 3676))).toBe('trollside');
        expect(eadgarZone(at(2907, 10019))).toBe('trollside');
        expect(eadgarZone(at(2946, 3369))).toBe('mainland');
        expect(eadgarZone(at(2611, 3287))).toBe('mainland');
        expect(eadgarZone(null)).toBe('unknown');
    });

    test('only the mainland is cheap enough to bank from', () => {
        expect(committed(eadgarZone(at(2946, 3369)))).toBe(false);
        expect(committed(eadgarZone(null))).toBe(false);
        for (const tile of [at(2893, 10074, 2), at(2844, 10057, 1), at(2891, 3676)]) {
            expect(committed(eadgarZone(tile))).toBe(true);
        }
    });
});

describe("Eadgar's Ruse item identity", () => {
    // Why: every unfinished potion in 2004 displays as "Unfinished potion", so the ranarr vial is
    // only ever safe to address by id.
    test('the ranarr vial is addressed by id, not by its shared display name', () => {
        expect(ER_ITEM.RANARR_VIAL.id).toBe(99);
        expect(ER_ITEM.RANARR_VIAL.name).toBe('Unfinished potion');
    });

    test('the quest-issued names match the content obj configs', () => {
        expect(ER_ITEM.GOUTWEED.name).toBe('Goutweed');
        expect(ER_ITEM.DRIED_THISTLE.name).toBe('Dried thistle');
        expect(ER_ITEM.GROUND_THISTLE.name).toBe('Ground thistle');
        expect(ER_ITEM.TROLL_POTION.name).toBe('Troll potion');
        expect(ER_ITEM.ALCO_CHUNKS.name).toBe('Alco-chunks');
        expect(ER_ITEM.DIRTY_ROBE.name).toBe('Dirty robe');
        expect(ER_ITEM.STOREROOM_KEY.name).toBe('Storeroom key');
    });
});
