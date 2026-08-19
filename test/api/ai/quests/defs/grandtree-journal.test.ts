import { describe, expect, test } from 'bun:test';

import { GT_STAGE } from '#/bot/api/ai/quests/defs/grandtree/areas.js';
import { parseGrandTreeJournal } from '#/bot/api/ai/quests/defs/grandtree/journal.js';

/**
 * `grandtree_journal.rs2` rendered stage by stage: every finished step stays on
 * the page as a `@str@` line, which is what makes the needles order-sensitive.
 */
function page(stage: number, opts: { rock?: boolean } = {}): string {
    if (stage === GT_STAGE.NOT_STARTED) {
        return '@dbl@I can start this quest at the @dre@Grand Tree@dbl@ in the @dre@Gnome|'
            + '@dre@Stronghold@dbl@ by speaking to @dre@King Narnode Shareen@dbl@.|'
            + '|@dbl@I must have:|@str@Level 25 Agility.|'
            + '@dre@High enough combat to defeat a level 172 demon.';
    }
    if (stage === GT_STAGE.STARTED) {
        return '@dre@King Narnode@dbl@ has told me that the Grand Tree is dying and|'
            + '@dbl@has asked me to help. He has asked me to take a @dre@sample of|'
            + '@dre@bark@dbl@ to the gnome @dre@Hazelmere@dbl@ who lives on an island east|'
            + '@dbl@of @dre@Yanille.@dbl@ I will need to @dre@translate@dbl@ what he says using the|'
            + '@dre@translation book@dbl@ Narnode gave me.';
    }
    let x = '@str@King Narnode has told me that the Grand Tree is dying and|'
        + '@str@has asked me to help. I have taken a bark sample from the|'
        + '@str@Grand tree from King Narnode to Hazelmere.|';
    if (stage === GT_STAGE.SPOKEN_HAZELMERE) {
        return x + '@dre@Hazelmere@dbl@ took the bark sample and gave me a @dre@message|'
            + '@dbl@that I need to @dre@translate@dbl@ using the @dre@translation book.@dbl@ I then|'
            + '@dbl@need to give the message to @dre@King Narnode.';
    }
    x += '@str@Hazelmere took the bark sample and gave me a message|'
        + '@str@that I translated and passed on to Kind Narnode. It seems|'
        + '@str@that Daconia rocks are killing the Grand tree!||';
    if (stage === GT_STAGE.RELAYED_MESSAGE) {
        return x + '@dbl@The King wants me to tell @dre@Glough@dbl@ about the Daconia rocks.|'
            + '@dbl@He lives in a @dre@tree house@dbl@ just in front of the @dre@Grand Tree.';
    }
    x += '@str@On instructions from the King, I found Glough to tell him|@str@about the Daconia rocks.|';
    if (stage === GT_STAGE.SPOKEN_GLOUGH) {
        return x + '@dbl@I told @dre@Glough@dbl@ about the Daconia rocks and he blames it on|'
            + '@dbl@humans. Maybe I should have a chat with @dre@King Narnode@dbl@.';
    }
    x += '@str@I told Glough about the Daconia rocks and he blames it on|@str@humans.|';
    if (stage === GT_STAGE.FOUND_PRISONER) {
        return x + '@dre@King Narnode@dbl@ said I can speak to @dre@Charlie@dbl@, the prisoner at|'
            + '@dbl@the @dre@top@dbl@ of the @dre@Grand Tree.';
    }
    x += '@str@I found Charlie, the prisoner, and talked to him.|';
    if (stage === GT_STAGE.SPOKEN_PRISONER) {
        return x + "@dbl@I spoke to @dre@Charlie@dbl@ and agreed to @dre@search Glough's house@dbl@,|"
            + '@dbl@which is just in front of the @dre@Grand Tree@dbl@.';
    }
    x += "@str@I spoke to Charlie and agreed to search Glough's house,|"
        + '@str@which is just in front of the Grand Tree.|';
    if (stage === GT_STAGE.FOUND_JOURNAL) {
        return x + "@dbl@I found @dre@Glough's journal@dbl@ in his tree house.|@dbl@I should go speak to him again.";
    }
    x += '@str@Glough threw me in prison but the King freed me!||';
    if (stage === GT_STAGE.RELEASED_PRISON) {
        return x + '@dre@King Narnode@dbl@ has told me to use the @dre@glider. Charlie@dbl@ told me|'
            + '@dbl@to go to the @dre@shipyard@dbl@ in the @dre@Karamja jungle@dbl@ and speak to|'
            + '@dbl@the @dre@foreman@dbl@. The password is @dre@Ka-Lu-Min';
    }
    x += '@str@I crash landed in Karamja jungle and made my way to the|@str@shipyard.|';
    if (stage === GT_STAGE.OBTAINED_LUMBER_ORDER) {
        return x + '@dbl@I have an @dre@invoice@dbl@ that the foreman had. I need to find|'
            + "@dbl@more proof of Glough's plans.";
    }
    x += '@str@I have an invoice that the foreman had. I need to find|@str@more proof of Glough\'s plans.|';
    if (stage === GT_STAGE.CLUE_CHARLIE) {
        return x + '@dre@Charlie@dbl@ has suggested I ask @dre@Anita@dbl@ for the @dre@keys|'
            + "@dbl@to @dre@Glough's chest.@dbl@ She lives west of the @dre@toad swamp.";
    }
    x += "@str@I asked Anita, Glough's girlfriend, for the keys to Glough's|@str@chest.|"
        + "@str@I found invasion plans in Glough's chest!|";
    if (stage === GT_STAGE.FOUND_INVASION_PLANS) {
        return x + '@dbl@I should talk to the King and see what he says...';
    }
    if (stage === GT_STAGE.GIVEN_TWIGS) {
        return x + "@dbl@King Narnode@dbl@ isn't convinced but gave me some @dre@twigs|"
            + "@dbl@found at Glough's house. I wonder what they are for?";
    }
    x += "@str@I used the twigs to open a trap door in Glough's house.||";
    if (stage === GT_STAGE.UNLOCKED_TRAPDOOR) {
        return x + "@dbl@I should investigate what's behind the @dre@trap door@dbl@ in Glough's|@dbl@house.";
    }
    x += '@str@I defeated the Black Demon that Glough set on me! Glough|@str@fled like the coward he really is.||';
    if (stage === GT_STAGE.DEFEATED_BLACK_DEMON) {
        return x + '@dbl@I should talk to @dre@King Narnode@dbl@ and tell him what happened.|'
            + '@dbl@He should be in these caves somewhere.';
    }
    x += '@str@I should talk the King and tell him what happened.||';
    if (stage === GT_STAGE.SEARCHING_DACONIA) {
        return x + (opts.rock
            ? '@dre@King Narnode@dbl@ has seen the light. I have found a @dre@Daconia|'
              + "@dre@rock@dbl@ that was hidden amongst the @dre@Grand Tree's roots.|"
              + '@dre@I need to give it to the King.'
            : '@dre@King Narnode@dbl@ has seen the light. I need to find a @dre@Daconia|'
              + "@dre@rock@dbl@ that is hidden amongst the @dre@Grand Tree's roots.");
    }
    return x + '@str@King Narnode has seen the light. I found the last of the|'
        + '@str@Daconia rocks and the Grand Tree is safe.||@dre@QUEST COMPLETE!';
}

const STAGES = [
    GT_STAGE.NOT_STARTED,
    GT_STAGE.STARTED,
    GT_STAGE.SPOKEN_HAZELMERE,
    GT_STAGE.RELAYED_MESSAGE,
    GT_STAGE.SPOKEN_GLOUGH,
    GT_STAGE.FOUND_PRISONER,
    GT_STAGE.SPOKEN_PRISONER,
    GT_STAGE.FOUND_JOURNAL,
    GT_STAGE.RELEASED_PRISON,
    GT_STAGE.OBTAINED_LUMBER_ORDER,
    GT_STAGE.CLUE_CHARLIE,
    GT_STAGE.FOUND_INVASION_PLANS,
    GT_STAGE.GIVEN_TWIGS,
    GT_STAGE.UNLOCKED_TRAPDOOR,
    GT_STAGE.DEFEATED_BLACK_DEMON,
    GT_STAGE.SEARCHING_DACONIA,
    GT_STAGE.COMPLETE
];

describe('parseGrandTreeJournal', () => {
    for (const stage of STAGES) {
        test(`reads stage ${stage}`, () => {
            expect(parseGrandTreeJournal(page(stage))).toBe(stage);
        });
    }

    test('reads stage 150 with the rock already in the pack', () => {
        expect(parseGrandTreeJournal(page(GT_STAGE.SEARCHING_DACONIA, { rock: true })))
            .toBe(GT_STAGE.SEARCHING_DACONIA);
    });

    test('accepts the journal as the line array the log returns', () => {
        expect(parseGrandTreeJournal(page(GT_STAGE.CLUE_CHARLIE).split('|'))).toBe(GT_STAGE.CLUE_CHARLIE);
    });

    test('an unrenderable page is undefined rather than not-started', () => {
        expect(parseGrandTreeJournal('')).toBeUndefined();
        expect(parseGrandTreeJournal('@dbl@Some other quest entirely.')).toBeUndefined();
    });
});
