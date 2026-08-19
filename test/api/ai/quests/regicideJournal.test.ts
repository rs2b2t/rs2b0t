import { describe, expect, test } from 'bun:test';

import { RG_FLAG, RG_STAGE, parseRegicideJournal } from '#/bot/api/ai/quests/defs/regicide/journal.js';

// Why: the journal is strictly additive and every earlier line comes back struck through, so a parser that matched the first line it found would answer stage 1 for a finished quest. These are the lines as `regicide_journal.rs2` writes them, colour codes and all — taken from `regicide_journal.rs2`, colour codes and all.
const COURIER = '@str@A courier has given me a message. I have been sent for|@str@ by King Lathas. I must go to his castle in Ardougne.||';
const LATHAS = '@str@King Lathas has asked me to re-enter the underground @str@pass. Now that the Well of Voyage is repaired I\'m to go @str@to the realm beyond.||';
const SCOUTS = '@str@I have met a elvish scout party, who said I should go see @str@Lord Iorwerth@str@.||';
const IORWERTH = '@str@Lord Iorwerth has offered the help of one of his @str@trackers@str@, who I\'m to meet with at a camp Tyras recently @str@abandoned.||';
const PENDANT = '@dbl@Lord Iorwerth has given me his pendant as proof that I am not the intruder that the @dre@tracker@dbl@ believes me to be.||';
const NO_PROOF = '@dbl@The tracker didn\'t trust me and asked for some @dre@proof@dbl@ that I had been sent by @dre@Lord Iorwerth@dbl@.||';
const SHOWN = '@str@After proving that I was not a bandit the tracker has @str@offered his help.||';
const TRACKS = '@str@I have found some tracks leading off into the @str@undergrowth @str@but I am unable to follow them.||';
const TRACKER2 = '@str@I asked the tracker about the tracks, he told me of signs to @str@look for and how to @str@pass@str@ the @str@dense woodland@str@.||';
const SOLDIER = '@str@Pushing my way through the undergrowth I encountered @str@a soldier, one of King Tyras\'s men I guess.||';
const CAMP = '@str@I have found the camp of King Tyras hidden in the woods @str@The king is in his tent and is well guarded.||';
const BOOK = '@str@Lord Iorwerth@str@ has given me a @str@book@str@. It may be of help.||';
const CHEMIST = '@dbl@The chemist read the book and told me I need to make Naphta, Quicklime and Brimstone.||';
const CATAPULT = '@dbl@The catapult provided a great way to deliver my gift to King Tyras and no one is any the wiser it was me.||';
const LETTER = '@dbl@Lord Iorwerth has given me a @dre@message@dbl@ to carry to @dre@King Lathas@dbl@.|';
const ARIANWYN = '@dbl@When returning home I met an elf who showed me the truth of who\'s side I really was on.||';
const DONE = '@str@I have told King Lathas about Tyras\'s death.||@red@QUEST COMPLETE!';

const upTo = (...lines: string[]): string[] => lines;

describe('parseRegicideJournal', () => {
    // Why: Underground Pass opens its own scroll with the same sentence, one street away.
    test("Underground Pass's own not-started scroll is not a Regicide stage", () => {
        const upass = '@dbl@I can start this quest by speaking to @dre@King Lathas@dbl@ who is in @dre@East Ardougne@dbl@.';
        expect(parseRegicideJournal([upass])).toBeUndefined();
    });

    test('the not-started scroll reads stage 0, before the messenger has been sent', () => {
        const text = '@dbl@I can start this quest by speaking to @dre@King Lathas@dbl@ in @dre@Ardougne Castle@dbl@.||';
        expect(parseRegicideJournal([text])?.stage).toBe(RG_STAGE.NOT_STARTED);
    });

    test('the waiting-for-word scroll reads stage 0 too', () => {
        const text = '@dre@King Lathas@dbl@ will send word when I can start this quest.|';
        expect(parseRegicideJournal([text])?.stage).toBe(RG_STAGE.NOT_STARTED);
    });

    const CASES: [string, string[], number][] = [
        ['the courier', upTo(COURIER), RG_STAGE.RECEIVED_MESSAGE],
        ['King Lathas', upTo(COURIER, LATHAS), RG_STAGE.SPOKEN_LATHAS],
        ['the scouts', upTo(COURIER, LATHAS, SCOUTS), RG_STAGE.SPOKEN_SCOUTS],
        ['Lord Iorwerth', upTo(COURIER, LATHAS, SCOUTS, IORWERTH), RG_STAGE.SPOKEN_IORWERTH],
        ['the tracker refusing', upTo(COURIER, LATHAS, SCOUTS, IORWERTH, NO_PROOF), RG_STAGE.SPOKEN_TRACKER],
        ['the pendant', upTo(COURIER, LATHAS, SCOUTS, IORWERTH, PENDANT), RG_STAGE.SPOKEN_TRACKER],
        ['the pendant shown', upTo(COURIER, LATHAS, SCOUTS, IORWERTH, SHOWN), RG_STAGE.SHOWN_PENDANT],
        ['the tracks', upTo(COURIER, LATHAS, SCOUTS, IORWERTH, SHOWN, TRACKS), RG_STAGE.FOUND_FOOTPRINTS],
        ['the tracker again', upTo(COURIER, LATHAS, SCOUTS, IORWERTH, SHOWN, TRACKS, TRACKER2), RG_STAGE.SPOKEN_TRACKER2],
        ['the soldier', upTo(COURIER, LATHAS, SHOWN, TRACKS, TRACKER2, SOLDIER), RG_STAGE.DEFEATED_GUARD],
        ['the camp', upTo(COURIER, LATHAS, SHOWN, TRACKS, TRACKER2, SOLDIER, CAMP), RG_STAGE.ENTERED_CAMP],
        ['the book', upTo(COURIER, LATHAS, SHOWN, TRACKS, TRACKER2, SOLDIER, CAMP, BOOK), RG_STAGE.SPOKEN_IORWERTH2],
        ['the catapult', upTo(COURIER, LATHAS, CAMP, BOOK, CATAPULT), RG_STAGE.KILLED_TYRAS],
        ['the letter', upTo(COURIER, LATHAS, CAMP, BOOK, CATAPULT, LETTER), RG_STAGE.REPORTED_IORWERTH],
        ['Arianwyn', upTo(COURIER, LATHAS, CAMP, BOOK, CATAPULT, LETTER, ARIANWYN), RG_STAGE.SPOKEN_ARIANWYN],
        ['the reward', upTo(DONE), RG_STAGE.COMPLETE]
    ];

    test.each(CASES)('%s reads its own stage', (_what, lines, stage) => {
        expect(parseRegicideJournal(lines)?.stage).toBe(stage);
    });

    test('the pendant line is carried as a flag, so a handed-over pendant is still remembered', () => {
        const progress = parseRegicideJournal(upTo(COURIER, LATHAS, SCOUTS, IORWERTH, PENDANT));
        expect(progress?.flags.has(RG_FLAG.PENDANT)).toBe(true);
    });

    test('a tracker who refused leaves no pendant flag', () => {
        const progress = parseRegicideJournal(upTo(COURIER, LATHAS, SCOUTS, IORWERTH, NO_PROOF));
        expect(progress?.flags.has(RG_FLAG.PENDANT)).toBe(false);
    });

    test('the chemist line is carried as a flag', () => {
        const progress = parseRegicideJournal(upTo(COURIER, LATHAS, CAMP, BOOK, CHEMIST));
        expect(progress?.stage).toBe(RG_STAGE.SPOKEN_IORWERTH2);
        expect(progress?.flags.has(RG_FLAG.CHEMIST)).toBe(true);
    });
});
