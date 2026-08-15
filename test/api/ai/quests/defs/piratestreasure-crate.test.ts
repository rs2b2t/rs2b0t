import { expect, test, describe } from 'bun:test';
import { readCrateMessages } from '#/bot/api/ai/quests/defs/piratestreasure/crate.js';

describe('banana crate messages', () => {
    test('completely empty', () => {
        expect(readCrateMessages(['The crate is completely empty.'])).toEqual({ rum: false, bananas: 0 });
    });
    test('rum alone', () => {
        expect(readCrateMessages([
            'There is some rum in here, although with no bananas to cover it.',
            'It is a little obvious.'
        ])).toEqual({ rum: true, bananas: 0 });
    });
    test('one banana is singular', () => {
        expect(readCrateMessages(['The crate has 1 banana inside.'])).toEqual({ rum: false, bananas: 1 });
    });
    test('several bananas and the rum', () => {
        expect(readCrateMessages([
            'The crate has 7 bananas inside.',
            'There is also some rum stashed in here too.'
        ])).toEqual({ rum: true, bananas: 7 });
    });
    test('full reads as ten without a number in the line', () => {
        expect(readCrateMessages([
            'The crate is full of bananas.',
            'There is also some rum stashed in here too.'
        ])).toEqual({ rum: true, bananas: 10 });
    });
    test('unrelated chatter is not a crate reading', () => {
        expect(readCrateMessages(['You pick a banana.'])).toBeNull();
    });
});
