import { beforeEach, describe, expect, test } from 'bun:test';

import { CANT_REACH, GameMessages } from '#/bot/events/gameMessages.js';

describe('GameMessages', () => {
    beforeEach(() => GameMessages.reset());

    test('mark starts at 0 and advances per record', () => {
        expect(GameMessages.mark()).toBe(0);
        GameMessages.record('Welcome to RuneScape');
        expect(GameMessages.mark()).toBe(1);
    });

    test('sawSince only sees messages recorded after the mark', () => {
        GameMessages.record("I can't reach that!");
        const mark = GameMessages.mark();
        expect(GameMessages.sawSince(mark, CANT_REACH)).toBe(false);
        GameMessages.record("I can't reach that!");
        expect(GameMessages.sawSince(mark, CANT_REACH)).toBe(true);
    });

    test('identical repeated texts are distinct messages', () => {
        GameMessages.record('x');
        const mark = GameMessages.mark();
        GameMessages.record('x');
        GameMessages.record('x');
        expect(GameMessages.since(mark).length).toBe(2);
    });

    test('ring caps at 64 but seq keeps climbing', () => {
        for (let i = 0; i < 70; i++) {
            GameMessages.record(`m${i}`);
        }
        expect(GameMessages.mark()).toBe(70);
        expect(GameMessages.since(0).length).toBe(64);
        expect(GameMessages.since(0)[0].text).toBe('m6');
    });

    test('CANT_REACH matches the live server line', () => {
        expect(CANT_REACH.test("I can't reach that!")).toBe(true);
        expect(CANT_REACH.test('You can reach that')).toBe(false);
    });
});
