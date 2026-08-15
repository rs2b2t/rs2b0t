import { describe, expect, test } from 'bun:test';

import { KELI_PRINT, NED_ROPE, NED_WIG, OSMAN_BRIEF, PA_ITEM } from '#/bot/api/ai/quests/defs/princeali/areas.js';
import { pickPreferred } from '#/bot/api/ai/quests/exec/primitives.js';

describe('Osman briefing cannot loop', () => {
    // osman_second_thing re-offers "What is the first thing I must do?". A prefer list
    // led by that bounces between the two branches forever.
    const INSTRUCTIONS = ['What is the first thing I must do?', 'What is the second thing you need?'];
    const FIRST_THING = [
        'Explain the first thing again.',
        'What is the second thing you need?',
        'Okay, I better go find some things.'
    ];
    const SECOND_THING = [
        'What is the first thing I must do?',
        'What exactly is the second thing you need?',
        'Okay, I better go find some things.'
    ];

    test('the first page moves on to a branch', () => {
        expect(pickPreferred(INSTRUCTIONS, OSMAN_BRIEF.prefer)).toBe('What is the second thing you need?');
    });

    test('the second-thing page takes the exit, not the way back', () => {
        expect(pickPreferred(SECOND_THING, OSMAN_BRIEF.prefer)).toBe('Okay, I better go find some things.');
    });

    test('the first-thing page also takes the exit', () => {
        expect(pickPreferred(FIRST_THING, OSMAN_BRIEF.prefer)).toBe('Okay, I better go find some things.');
    });
});

describe('Ned never spends four balls of wool on rope', () => {
    const STANDARD = [
        'Ned, could you make other things from wool?',
        'Yes, I would like some rope.',
        "No thanks, Ned. I don't need any."
    ];
    const WITHOUT_WOOL = [
        'Okay, please sell me some rope.',
        "That's a little more than I want to pay.",
        'I will go and get some wool.'
    ];
    const WITH_WOOL = [
        'Okay, please sell me some rope.',
        "That's a little more than I want to pay.",
        'I have some balls of wool. Could you make me some rope?'
    ];

    test('opens by asking for rope, not for wool work', () => {
        expect(pickPreferred(STANDARD, NED_ROPE.prefer)).toBe('Yes, I would like some rope.');
    });

    test('pays 15 coins with no wool in the pack', () => {
        expect(pickPreferred(WITHOUT_WOOL, NED_ROPE.prefer)).toBe('Okay, please sell me some rope.');
    });

    test('still pays 15 coins when four balls of wool are in the pack', () => {
        expect(pickPreferred(WITH_WOOL, NED_ROPE.prefer)).toBe('Okay, please sell me some rope.');
    });
});

describe('Ned makes the wig in three picks', () => {
    const STANDARD = [
        'Ned, could you make other things from wool?',
        'Yes, I would like some rope.',
        "No thanks, Ned. I don't need any."
    ];
    const OTHER_THINGS = [
        'Could you knit me a sweater?',
        'How about some sort of wig?',
        'Could you repair the arrow holes in the back of my shirt?'
    ];
    const WIG = ['I have that now. Please, make me a wig.', 'I will come back when I need you to make me one.'];

    test('page 1 asks about wool work', () => {
        expect(pickPreferred(STANDARD, NED_WIG.prefer)).toBe('Ned, could you make other things from wool?');
    });

    test('page 2 asks for a wig', () => {
        expect(pickPreferred(OTHER_THINGS, NED_WIG.prefer)).toBe('How about some sort of wig?');
    });

    test('page 3 hands over the wool', () => {
        expect(pickPreferred(WIG, NED_WIG.prefer)).toBe('I have that now. Please, make me a wig.');
    });
});

describe('Lady Keli walks all five pages to the imprint', () => {
    const PAGES: string[][] = [
        [
            'Heard of you? You are famous in RuneScape!',
            'I have heard a little, but I think Katrine is tougher.',
            'I have heard rumours that you kill people.',
            'No I have never really heard of you.'
        ],
        [
            'I think Katrine is still tougher.',
            'What is your latest plan then?',
            'You must have trained a lot for this work.',
            'I should not disturb someone as tough as you.'
        ],
        [
            'Ah I see. You must have been very skillful.',
            'Thats great, are you sure they will pay?',
            'Can you be sure they will not try to get him out?',
            'I should not disturb someone as tough as you.'
        ],
        [
            'Could I see the key please?',
            'That is a good way to keep secrets.',
            'I should not disturb someone as tough as you.'
        ],
        ['Could I touch the key for a moment?', 'I should not disturb someone as tough as you.']
    ];
    const WANT = [
        'Heard of you? You are famous in RuneScape!',
        'What is your latest plan then?',
        'Can you be sure they will not try to get him out?',
        'Could I see the key please?',
        'Could I touch the key for a moment?'
    ];

    for (let i = 0; i < PAGES.length; i++) {
        test(`page ${i + 1} picks "${WANT[i]}"`, () => {
            expect(pickPreferred(PAGES[i], KELI_PRINT.prefer)).toBe(WANT[i]);
        });
    }

    test('never takes the polite exit, and never insults her into a dead end', () => {
        for (const page of PAGES) {
            const pick = pickPreferred(page, KELI_PRINT.prefer);
            expect(pick).not.toContain('I should not disturb');
            expect(pick).not.toContain('Katrine');
        }
    });
});

describe('item identity', () => {
    test('the two wigs share a name and differ only by id', () => {
        expect(PA_ITEM.PLAIN_WIG.name).toBe(PA_ITEM.BLOND_WIG.name);
        expect(PA_ITEM.PLAIN_WIG.id).not.toBe(PA_ITEM.BLOND_WIG.id);
    });

    test('ids match the engine obj.pack', () => {
        expect(PA_ITEM.BLOND_WIG.id).toBe(2419);
        expect(PA_ITEM.PLAIN_WIG.id).toBe(2421);
        expect(PA_ITEM.PRINCE_KEY.id).toBe(2418);
        expect(PA_ITEM.KEY_PRINT.id).toBe(2423);
        expect(PA_ITEM.PASTE.id).toBe(2424);
        expect(PA_ITEM.BEER.id).toBe(1917);
        expect(PA_ITEM.POT_OF_FLOUR.id).toBe(1933);
        expect(PA_ITEM.LOGS.id).toBe(1511);
        expect(PA_ITEM.COINS.id).toBe(995);
        expect(PA_ITEM.SOFT_CLAY.id).toBe(1761);
        expect(PA_ITEM.CLAY.id).toBe(434);
    });
});
