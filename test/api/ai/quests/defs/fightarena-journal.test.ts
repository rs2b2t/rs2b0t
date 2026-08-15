import { describe, expect, test } from 'bun:test';

import { FA_STAGE, normalizeJournal, parseFightArenaJournal, resetFightArenaStage } from '#/bot/api/ai/quests/defs/fightarena/journal.js';

const INTRO = '@str@I encountered a distraught Lady Servil who said that her|@str@son and husband have been kidnapped by the evil General|'
    + '@str@Khazard, and are being forced to fight in his Fight Arena.||';
const HEADED = '@str@I headed to the Arena to try and find Lady Servil\'s son and|@str@husband, but the guards wouldn\'t let me into the building.||';
const ARMOUR = '@str@Luckily I found some Khazard armour in a chest in a|@str@building on the north-east edge of the town. I used it to|'
    + '@str@disguise myself as a guard so I could look around.||';
const KEYS = '@str@After plying one of the guards with some Khali Brew I was|@str@able to steal his keys.||';
const JEREMY = '@str@Jeremy told me that his father had been taken to fight in|@str@the Fight Arena. We went to the arena to save him.||';
const OGRE = '@str@I had to fight a large Ogre to stop it killing Sir Servil. When|@str@I\'d defeated it, General Khazard had me locked up.||';
const SCORPION = '@str@I was led to the Fight Arena and forced to fight a collossal|@str@Scorpion.||';
const BOUNCER = '@str@I defeated a giant Scorpion and a monstrous dog in the|@str@Fight Arena.||';
const RETURNED = '@str@I then returned to Lady Servil and she thanked me for|@str@saving her family.||';

/** The bodies `arena_journal.rs2` builds, one per server stage. */
const JOURNAL: Record<number, string> = {
    0: '@dbl@I can start this quest by speaking to @dre@Lady Servil@dbl@ just|North-West@dbl@ of the @dre@Khazard Port.||'
        + '@dbl@I must be able to defeat a @dre@level 137@dbl@ enemy@dbl@.',
    1: INTRO + '@dbl@I should go to the @dre@Fight Arena@dbl@ and try to find her family.',
    2: INTRO + HEADED + '@dbl@Luckily I found some @dre@Khazard armour@dbl@ in a chest in a|building on the north-east edge of the town.',
    3: INTRO + HEADED + ARMOUR + '@dbl@One of the guards told me that he really likes @dre@Khali Brew@dbl@.',
    5: INTRO + HEADED + ARMOUR + KEYS + '@dbl@Now I\'ve got the keys I should try to rescue @dre@Lady Servil\'s|family@dbl@.',
    6: INTRO + HEADED + ARMOUR + KEYS + JEREMY + '@dbl@I need to protect @dre@Jeremy and his father@dbl@ from a huge|@dre@Ogre.',
    8: INTRO + HEADED + ARMOUR + KEYS + JEREMY + '@str@I had to fight a large Ogre to stop it killing Sir Servil.||'
        + '@dbl@I should talk to @dre@Jeremy@dbl@ in the @dre@Fight Arena@dbl@!',
    9: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + '@dbl@I\'m going to have to fight in the Arena!',
    10: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + SCORPION
        + '@dbl@After I\'d defeated the Scorpion, @dre@General Khazard@dbl@ ordered|me to fight his pet, @dre@Bouncer@dbl@.',
    11: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + SCORPION + BOUNCER
        + '@dre@General Khazard@dbl@ agreed to release the @dre@Servils@dbl@, but he|wants to kill me himself! I can stay to fight him, or I can run|@dbl@away.',
    12: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + SCORPION + BOUNCER
        + '@dre@General Khazard@dbl@ agreed to release the Servils. He|challenged me to fight him, but I ran away.|'
        + '@dbl@I should go and tell @dre@Lady Servil@dbl@ the good news.',
    13: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + SCORPION + BOUNCER
        + '@str@General Khazard released the Servils, but he was so angry|@str@that I\'d killed his pet that he came to fight me himself.||'
        + '@str@General Khazard was a tough foe, but I eventually killed|@str@him.|'
        + '@dbl@Now I should go and tell @dre@Lady Servil@dbl@ the good news.',
    14: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + SCORPION + BOUNCER
        + '@str@General Khazard agreed to release the Servils. He|@str@challenged me to fight him, but I ran away.||'
        + RETURNED + '@red@QUEST COMPLETE!',
    15: INTRO + HEADED + ARMOUR + KEYS + JEREMY + OGRE + SCORPION + BOUNCER
        + '@str@General Khazard released the Servils, but he was so angry|@str@that I\'d killed his pet that he came to fight me himself.||'
        + '@str@General Khazard was a tough foe, but I eventually killed|@str@him.||'
        + RETURNED + '@red@QUEST COMPLETE!'
};

describe('normalizeJournal', () => {
    test('strips colour tags, line breaks and case', () => {
        expect(normalizeJournal('@dbl@Now I\'ve got the keys@dre@.')).toBe('now i\'ve got the keys .');
    });
});

describe('parseFightArenaJournal', () => {
    for (const raw of [0, 1, 2, 3, 5, 6, 8, 9, 10, 11, 12, 13] as const) {
        test(`server stage ${raw} reads back as ${raw}`, () => {
            expect(parseFightArenaJournal(JOURNAL[raw])).toBe(raw);
        });
    }

    test('both completed endings read as COMPLETE', () => {
        expect(parseFightArenaJournal(JOURNAL[14])).toBe(FA_STAGE.COMPLETE);
        expect(parseFightArenaJournal(JOURNAL[15])).toBe(FA_STAGE.COMPLETE);
    });

    test('an empty journal is undefined rather than not-started', () => {
        expect(parseFightArenaJournal([])).toBeUndefined();
        expect(parseFightArenaJournal('')).toBeUndefined();
    });

    test('accepts the lines array the client hands back', () => {
        expect(parseFightArenaJournal([INTRO, '@dbl@I should go to the @dre@Fight Arena@dbl@ and try to find her family.'])).toBe(FA_STAGE.STARTED);
    });

    test('the cache can be cleared, so one account does not inherit another', () => {
        expect(resetFightArenaStage()).toBeUndefined();
    });
});
