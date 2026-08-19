import { beforeEach, describe, expect, test } from 'bun:test';

import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { verdictSince } from '#/bot/api/ai/quests/defs/upass/verdict.js';

// Why: every obstacle in the pass says what it did, in the same tick the op resolves — and the step waited on a tile that was never going to change, paying the full crossing timeout for a refusal it had already been told about. Live: twelve cages in a row at ten to fifteen seconds each, none of which moved anyone.

const say = (...lines: readonly string[]): number => {
    const mark = GameMessages.mark();
    for (const line of lines) {
        GameMessages.record(line);
    }
    return mark;
};

beforeEach(() => GameMessages.reset());

describe('what the chatbox says an obstacle did', () => {
    test('is nothing before the script has spoken', () => {
        expect(verdictSince(GameMessages.mark())).toBeNull();
    });

    test('reads a rockslide that carried the character as a crossing', () => {
        expect(verdictSince(say('You climb onto the rock...', '...and step down the other side.'))).toBe('crossing');
    });

    test('reads a rockslide that slipped as a failed roll, which is worth another try', () => {
        expect(verdictSince(say('You climb onto the rock...', '...but you slip back down.'))).toBe('failed');
    });

    test('reads a cage that opened as a crossing', () => {
        expect(verdictSince(say('You attempt to pick the lock...', 'You manage to pick the lock.', 'You walk through.', 'The cage slams shut behind you.'))).toBe('crossing');
    });

    test('reads a cage that did not as a failed roll', () => {
        expect(verdictSince(say('You attempt to pick the lock...', 'You fail to pick the lock.'))).toBe('failed');
    });

    test('reads the server refusing the side as refused, in both spellings the pass uses', () => {
        expect(verdictSince(say("You can't do that from here."))).toBe('refused');
        expect(verdictSince(say('You cannot do that from here.'))).toBe('refused');
    });

    test('reads a path that dead-ended as refused', () => {
        expect(verdictSince(say("I can't reach that!"))).toBe('refused');
    });

    test('reads every cooldown the pass has as refused, so no retry waits one out', () => {
        expect(verdictSince(say('The pipe is being used'))).toBe('refused');
        expect(verdictSince(say('The rock is being used.'))).toBe('refused');
        expect(verdictSince(say('The rope swing is being used'))).toBe('refused');
    });

    test('reads the grilled end of the first pipe as refused', () => {
        expect(verdictSince(say('The other end of the pipe is blocked by a grill.', 'You cannot open the grill from this side.'))).toBe('refused');
    });

    test('reads a thieving gate as refused rather than as a roll to repeat', () => {
        expect(verdictSince(say('You need a Thieving level of 50 to pick this lock.'))).toBe('refused');
    });

    test('takes the LAST verdict, so a roll that failed and then landed reads as a crossing', () => {
        expect(verdictSince(say(
            'You climb onto the rock...', '...but you slip back down.',
            'You climb onto the rock...', '...and step down the other side.'
        ))).toBe('crossing');
    });

    test('ignores anything said before the mark', () => {
        GameMessages.record('...and step down the other side.');
        expect(verdictSince(GameMessages.mark())).toBeNull();
    });

    test('reads the ledge, the bridges, the swing and the pipes', () => {
        expect(verdictSince(say('You fall in to the rat pit.'))).toBe('failed');
        expect(verdictSince(say('...and fall off it.'))).toBe('failed');
        expect(verdictSince(say('...and make it.'))).toBe('crossing');
        expect(verdictSince(say('... but you slip and tumble into the darkness.'))).toBe('failed');
        expect(verdictSince(say('... you manage to cross safely.'))).toBe('crossing');
        expect(verdictSince(say('You try to swing but fall in to the darkness.'))).toBe('failed');
        expect(verdictSince(say('You skillfully swing across.'))).toBe('crossing');
        expect(verdictSince(say('You crawl through the pipe.'))).toBe('crossing');
    });
});
