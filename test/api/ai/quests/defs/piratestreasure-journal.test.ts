import { expect, test, describe } from 'bun:test';
import { parsePiratesTreasureJournal } from '#/bot/api/ai/quests/defs/piratestreasure/journal.js';
import { PT_STAGE } from '#/bot/api/ai/quests/defs/piratestreasure/areas.js';

// Transcribed from quest_hunt/scripts/hunt_journal.rs2, colour tags included.
const NOT_STARTED = '@dbl@I can start this quest by speaking to @dre@Redbeard Frank@dbl@ who is at @dre@Port Sarim@dbl@.||@dbl@There aren\'t any requirements for this quest.';

const STARTED = '@dbl@I have spoken to @dre@Redbeard Frank@dbl@. He has agreed to tell me the location of some @dre@treasure@dbl@ for some @dre@Karamja Rum@dbl@.||';

const PLANTATION = '@dbl@I have taken employment on the @dre@banana plantation@dbl@, as the @dre@Customs Officers@dbl@ might not notice the @dre@rum@dbl@ if it is covered in @dre@bananas@dbl@.||';

const SHIPPED_HISTORY = '@str@I have taken employment on the banana plantation, as the|@str@Customs Officers might not notice the rum if it is covered in|@str@bananas.||@str@I have hidden my rum in the crate. I should fill it with|@str@bananas and speak to Luthas to have it shipped over.||';

const STORE_HISTORY = SHIPPED_HISTORY + '@str@I have spoken to Luthas, and the crate has been shipped to|@str@to Wydin\'s store in Port Sarim. Now all I have to do is|@str@get to it.||';

const KEY_HISTORY = '@str@I have spoken to Redbeard Frank. He has agreed to tell me|@str@the location of some treasure for some Karamja Rum.||@str@I have smuggled some rum off Karamja, and retrieved it|@str@from the back room of Wydin\'s shop.||@dbl@I have given the rum to @dre@Redbeard Frank@dbl@. He has told me that the @dre@treasure@dbl@ is hidden in the chest in the upstairs room of the @dre@Blue Moon Inn@dbl@ in @dre@Varrock@dbl@.||';

const NOTE_HISTORY = '@str@I have spoken to Redbeard Frank. He has agreed to tell me|@str@the location of some treasure for some Karamja Rum.||@str@I have smuggled some rum off Karamja, and retrieved it|@str@from the back room of Wydin\'s shop.||@str@I have given the rum to Redbeard Frank. He has told me|@str@that the treasure is hidden in the chest in the upstairs|@str@room of the Blue Moon Inn in Varrock.||@str@I have opened the chest in the Blue Moon, and found a|@str@note inside. I think it will tell me where to dig.||';

const flag = (text: string): string | undefined => {
    const progress = parsePiratesTreasureJournal(text);
    return progress ? [...progress.flags][0] : undefined;
};

describe('pirate journal — stages', () => {
    test('not started', () => {
        expect(parsePiratesTreasureJournal(NOT_STARTED)?.stage).toBe(PT_STAGE.NOT_STARTED);
    });
    test('fetch rum', () => {
        expect(parsePiratesTreasureJournal(STARTED + '@dbl@I need to go to @dre@Karamja@dbl@ and buy some @dre@rum@dbl@. I hope it is not too expensive.')?.stage).toBe(PT_STAGE.FETCH_RUM);
    });
    test('received key', () => {
        expect(parsePiratesTreasureJournal(KEY_HISTORY + '@dbl@I have a @dre@key@dbl@ that can be used to unlock the chest that hold the treasure.')?.stage).toBe(PT_STAGE.RECEIVED_KEY);
    });
    test('read note outranks the key history it keeps', () => {
        expect(parsePiratesTreasureJournal(NOTE_HISTORY + '@dbl@The note reads @dre@\'Visit the city of the White Knights. In the park, Saradomin points to the X which marks the spot.\'')?.stage).toBe(PT_STAGE.READ_NOTE);
    });
    test('complete outranks the note history it keeps', () => {
        expect(parsePiratesTreasureJournal(NOTE_HISTORY + '@str@The note reads \'Visit the city of the White Knights. In the|@str@park, Saradomin points to the X which marks the spot.\'||@red@QUEST COMPLETE!')?.stage).toBe(PT_STAGE.COMPLETE);
    });
    test('an unparseable page is undefined, not stage 0', () => {
        expect(parsePiratesTreasureJournal('')).toBeUndefined();
    });
});

describe('pirate journal — smuggle sub-state', () => {
    test('need rum', () => {
        expect(flag(STARTED + '@dbl@I need to go to @dre@Karamja@dbl@ and buy some @dre@rum@dbl@. I hope it is not too expensive.')).toBe('need-rum');
    });
    test('rum held, not employed', () => {
        expect(flag(STARTED + '@dbl@I have the @dre@rum@dbl@, and now I need to find a way to get the rum off @dre@Karamja@dbl@. This might be tricky, as the @dre@Customs Officers|@dbl@are searching people for it.')).toBe('rum-held-unemployed');
    });
    test('employed, no rum', () => {
        expect(flag(STARTED + PLANTATION + '@dbl@Now all I need is some @dre@rum@dbl@ to hide in the next crate destined for @dre@Wydin\'s store@dbl@.')).toBe('employed-need-rum');
    });
    test('employed, rum held', () => {
        expect(flag(STARTED + PLANTATION + '@dbl@I\'m sure I will be able to hide my @dre@rum@dbl@ in the next crate destined for @dre@Wydin\'s store@dbl@.')).toBe('rum-held-employed');
    });
    test('rum in the crate, bananas outstanding', () => {
        expect(flag(STARTED + PLANTATION + '@dbl@I have hidden my @dre@rum@dbl@ in the crate. I should fill it with @dre@bananas@dbl@ and speak to @dre@Luthas@dbl@ and have it shipped over.')).toBe('rum-in-crate');
    });
    test('crate full', () => {
        expect(flag(STARTED + PLANTATION + '@dbl@I have hidden my @dre@rum@dbl@ in the crate and filled it with @dre@bananas@dbl@. I should speak to @dre@Luthas@dbl@ and have it shipped|@dbl@over.')).toBe('crate-full');
    });
    test('shipped outranks the fill-it history it keeps', () => {
        expect(flag(STARTED + SHIPPED_HISTORY + '@dbl@I have spoken to @dre@Luthas@dbl@, and the crate has been shipped to @dre@Wydin\'s store@dbl@ in @dre@Port Sarim@dbl@. Now all I have to do is get to it.')).toBe('rum-shipped');
    });
    test('store job outranks the shipped history it keeps', () => {
        expect(flag(STARTED + STORE_HISTORY + '@dbl@I have taken a job at @dre@Wydin\'s store@dbl@. I now have access to the back room of his shop where the @dre@rum@dbl@ is hidden.')).toBe('store-job');
    });
    test('rum in hand', () => {
        expect(flag(STARTED + '@dbl@I have the @dre@Karamja Rum@dbl@. I should take it to @dre@Redbeard Frank@dbl@.')).toBe('rum-in-hand');
    });
    test('rum lost', () => {
        expect(flag(STARTED + '@dbl@I had some @dre@rum@dbl@, but I seem to have lost it. I will need to smuggle some more off @dre@Karamja@dbl@.')).toBe('rum-lost');
    });
    test('only stage 1 carries a smuggle flag', () => {
        expect(parsePiratesTreasureJournal(KEY_HISTORY + '@dbl@I have a @dre@key@dbl@ that can be used to unlock the chest that hold the treasure.')?.flags.size).toBe(0);
    });
});
