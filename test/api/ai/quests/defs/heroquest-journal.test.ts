import { describe, expect, test } from 'bun:test';

import { HERO_STAGE, parseHeroQuestJournal } from '#/bot/api/ai/quests/defs/heroquest/journal.js';

/** Lines as hero_journal.rs2 appends them: colour tags intact, pipes as breaks. */
const NOT_STARTED = [
    '@dbl@I can start this quest by speaking to @dre@Achietties@dbl@ at the|',
    '@dbl@entrance to the @dre@Heroes\' Guild@dbl@ in @dre@Burthorpe@dbl@.'
];

const HEADER = ['@dre@Achietties@dbl@ will let me into the @dre@Heroes\' Guild@dbl@ if I can get:|'];

const NO_FEATHER = [
    '@dbl@1) An @dre@Entranan firebird feather@dbl@.|',
    '@dbl@I should check if anyone important on @dre@Entrana@dbl@ knows|',
    '@dbl@where I can find an Entrana firebird.|'
];

const HAVE_FEATHER = [
    '@str@1) An Entranan firebird feather - I now have one!|',
    '@str@The high priest on Entrana confirmed that a firebird exists|'
];

const NO_EEL = ['@dbl@2) A @dre@cooked lava eel.|', '@dbl@I should speak to a @dre@fishing expert@dbl@.|'];
const HAVE_EEL = ['@str@2) A cooked lava eel - I now have one!|'];

const NO_ARMBAND = ['@dbl@3) A @dre@master thief\'s armband.|'];
const HAVE_ARMBAND = ['@str@3) A master thief\'s armband - I now have one!|'];

const PHOENIX_INTRO = [
    '@dbl@I worked with the @dre@Phoenix Gang@dbl@ when I was searching for the|',
    '@dre@Shield of Arrav@dbl@. I should visit their hideout, maybe they can|',
    '@dbl@help me.|'
];

const SPOKE_STRAVEN = ['@str@I spoke to Straven about the Master Thieves Armband.|'];
const TOLD_ALFONSE = ['@str@Then I told Alfonse the password \'Gherkin\'.|'];
const CHARLIE_DOOR = [
    '@str@Charlie told me about a secret door into Scarface Pete\'s|',
    '@str@hideout, but he couldn\'t find a way of getting through it.|'
];
const RIVAL_COLLECTED = [
    '@str@A rival gang member collected a candlestick for me after I|',
    '@str@killed Grip and got the Treasure Room key for them.|'
];

const SPOKE_KATRINE = [
    '@str@I spoke to Katrine about the master thief\'s armband. She|',
    '@str@told me I can get one by stealing one of Pete\'s candlesticks.|'
];
const USED_PASSWORD = [
    '@str@I used the Black Arm password to enter the Brimhaven Black|',
    '@str@Arm hideout, south-east of the Shrimp and Parrot.|'
];
const TROBERT_PAPERS = [
    '@str@Trobert, the Brimhaven Black Arm leader, told me that the|',
    '@str@key to the treasure room is carried by Grip, Scarface Pete\'s|',
    '@str@head guard. He provided me with the ID papers of Grip\'s new|',
    '@str@deputy, a deserter from the Black Knight\'s Fortress.|'
];
const PASSED_AS_HARTIGEN = [
    '@str@I managed to pass myself off as Hartigen the Black|',
    '@str@Knight and enter Scarface Pete\'s mansion.|'
];
const PRESENTED_TO_GRIP = [
    '@str@I presented myself to Grip, who has the key to the|',
    '@str@treasure room.|'
];
const HELPED_BY_PHOENIX = [
    '@str@With the help of a Phoenix Gang member who killed Grip|',
    '@str@for me, I managed to get a candlestick from the chest in|',
    '@str@the treasure room of Scarface Pete\'s mansion.|'
];

function page(...blocks: string[][]): string[] {
    return [...HEADER, ...NO_FEATHER, ...NO_EEL, ...NO_ARMBAND, ...blocks.flat()];
}

describe('parseHeroQuestJournal — Phoenix side', () => {
    test('the opening page is the not-started page', () => {
        expect(parseHeroQuestJournal(NOT_STARTED)?.stage).toBe(HERO_STAGE.NOT_STARTED);
    });

    test('started, before Straven, is the gang intro alone', () => {
        expect(parseHeroQuestJournal(page(PHOENIX_INTRO))?.stage).toBe(HERO_STAGE.STARTED);
    });

    test('Straven names the Brimhaven password', () => {
        const lines = page(PHOENIX_INTRO, SPOKE_STRAVEN, [
            '@dbl@He told me that I can get one by stealing @dre@Pete\'s Candlestick|',
            '@dbl@I should use the password he gave me at @dre@Brimhaven'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.PHOENIX_SPOKEN);
    });

    test('Alfonse sends you round the back', () => {
        const lines = page(PHOENIX_INTRO, SPOKE_STRAVEN, TOLD_ALFONSE, [
            '@dbl@He said I should speak to @dre@Charlie@dbl@ round the back'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.PHOENIX_ALFONSE);
    });

    test('Charlie leaves the door as the open question', () => {
        const lines = page(PHOENIX_INTRO, SPOKE_STRAVEN, TOLD_ALFONSE, CHARLIE_DOOR, [
            '@dbl@Maybe @dre@another player@dbl@ can help me get through this @dre@door@dbl@?'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.PHOENIX_CHARLIE);
    });

    test('after the kill the page waits on the candlestick', () => {
        const lines = page(PHOENIX_INTRO, SPOKE_STRAVEN, TOLD_ALFONSE, CHARLIE_DOOR, RIVAL_COLLECTED, [
            '@dbl@As soon as they have given me my @dre@candlestick@dbl@ I should|',
            '@dbl@head back to @dre@Varrock@dbl@ and give it to @dre@Straven@dbl@ for my @dre@reward'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.PHOENIX_KILLED_GRIP);
    });

    test('Straven hands the armband over', () => {
        const lines = [
            ...HEADER, ...NO_FEATHER, ...NO_EEL, ...HAVE_ARMBAND,
            ...SPOKE_STRAVEN, ...TOLD_ALFONSE, ...CHARLIE_DOOR, ...RIVAL_COLLECTED,
            '@str@I gave Straven Scarface Pete\'s candlestick, and in reward|',
            '@str@he gave me a Master Thieves Armband to prove my skills.|'
        ];
        const progress = parseHeroQuestJournal(lines);
        expect(progress?.stage).toBe(HERO_STAGE.PHOENIX_ARMBAND);
        expect(progress?.flags.has('armband')).toBe(true);
    });
});

describe('parseHeroQuestJournal — Black Arm side', () => {
    test('started, before Katrine, names her as the contact', () => {
        const lines = page([
            '@dre@Katrine@dbl@ (the leader of the @dre@Black Arm Gang@dbl@ in @dre@south-west|',
            '@dre@Varrock@dbl@) can help me.'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.STARTED);
    });

    test('Katrine names the Brimhaven password', () => {
        const lines = page(SPOKE_KATRINE, [
            '@dbl@I should say the password she gave me at @dbl@the @dre@Black|',
            '@dre@Arm hideout@dbl@ in @dre@Brimhaven@dbl@. @dbl@It\'s located @dre@south-east@dbl@ of|',
            '@dbl@the @dre@Shrimp and Parrot@dbl@.'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_SPOKEN);
    });

    test('inside the hideout the page points at the other gang members', () => {
        const lines = page(SPOKE_KATRINE, USED_PASSWORD, [
            '@dbl@I should speak to other gang members in the hideout for',
            '@dbl@help.'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_HQ);
    });

    test('with the papers the page asks for the disguise', () => {
        const lines = page(SPOKE_KATRINE, USED_PASSWORD, TROBERT_PAPERS, [
            '@dbl@I need to disguise myself as @dre@Hartigen the Black Knight@dbl@ in|',
            '@dbl@order to get inside @dre@Scarface Pete\'s mansion.'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_PAPERS);
    });

    test('inside the mansion the page asks for Grip', () => {
        const lines = page(SPOKE_KATRINE, USED_PASSWORD, TROBERT_PAPERS, PASSED_AS_HARTIGEN, [
            '@dbl@Now I need to present myself to @dre@Grip@dbl@, the head guard.'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_MANSION);
    });

    // Why: the struck-through "I presented myself to Grip" line is on every later page, and a needle
    // without the leading "need to" would read stage 10 for the rest of the quest.
    test('after the papers the page waits on the key', () => {
        const lines = page(SPOKE_KATRINE, USED_PASSWORD, TROBERT_PAPERS, PASSED_AS_HARTIGEN, PRESENTED_TO_GRIP, [
            '@dbl@I can move around the hideout, but now I need @dre@Grip\'s key|',
            '@dbl@ to get into the @dre@treasure room@dbl@ and get the @dre@candlestick@dbl@.|',
            '@dbl@Maybe @dre@another player@dbl@ can help me discreetly defeat @dre@Grip@dbl@?|'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_PAPERS_GIVEN);
    });

    test('after the chest the page owes the rival a candlestick', () => {
        const lines = page(SPOKE_KATRINE, USED_PASSWORD, TROBERT_PAPERS, PASSED_AS_HARTIGEN, PRESENTED_TO_GRIP, HELPED_BY_PHOENIX, [
            '@dbl@After rewarding the player who assisted me, I should take|',
            '@dre@the Pete\'s candlestick@dbl@ to @dre@Katrine@dbl@ for my @dre@master thief\'s|',
            '@dre@armband@dbl@.|'
        ]);
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_LOOTED);
    });

    test('Katrine hands the armband over', () => {
        const lines = [
            ...HEADER, ...NO_FEATHER, ...NO_EEL, ...HAVE_ARMBAND,
            ...SPOKE_KATRINE, ...USED_PASSWORD, ...TROBERT_PAPERS, ...PASSED_AS_HARTIGEN,
            ...PRESENTED_TO_GRIP, ...HELPED_BY_PHOENIX,
            '@str@I gave Scarface Pete\'s candlestick to Katrine, and in|',
            '@str@reward she gave me a master thief\'s armband.|'
        ];
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.BLACKARM_ARMBAND);
    });
});

describe('parseHeroQuestJournal — items and completion', () => {
    test('the completed page is complete', () => {
        const lines = [
            '@str@I gave Achietties an Entranan firebird feather, a cooked|',
            '@str@lava eel from a dangerous fishing spot and (after some|',
            '@str@difficulty) a master thief\'s armband, and proved myself|',
            '@str@worthy of entrance to the Heroes\' Guild.|',
            '@dre@QUEST COMPLETE!'
        ];
        expect(parseHeroQuestJournal(lines)?.stage).toBe(HERO_STAGE.COMPLETE);
    });

    test('each held item raises its own flag', () => {
        const lines = [
            ...HEADER, ...HAVE_FEATHER, ...HAVE_EEL, ...HAVE_ARMBAND,
            ...SPOKE_KATRINE, ...USED_PASSWORD, ...TROBERT_PAPERS, ...PASSED_AS_HARTIGEN,
            ...PRESENTED_TO_GRIP, ...HELPED_BY_PHOENIX,
            '@str@I gave Scarface Pete\'s candlestick to Katrine, and in|',
            '@str@reward she gave me a master thief\'s armband.|',
            '@dbl@I have @dre@all required items@dbl@. I should give them to @dre@Achietties@dbl@ at|',
            '@dbl@the entrance to the @dre@Heroes\' Guild@dbl@ in @dre@Burthorpe@dbl@.'
        ];
        const progress = parseHeroQuestJournal(lines);
        expect([...(progress?.flags ?? [])].sort()).toEqual(['armband', 'eel', 'feather', 'ready-to-hand-in']);
    });

    test('an unreadable page is not a stage', () => {
        expect(parseHeroQuestJournal([])).toBeUndefined();
        expect(parseHeroQuestJournal(['@dbl@something else entirely'])).toBeUndefined();
    });
});
