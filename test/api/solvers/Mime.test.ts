import { describe, expect, test } from 'bun:test';
import { MIME_EMOTE_BY_SEQ, MIME_IF, mimeAnswer } from '#/bot/api/solvers/Mime.js';

describe('mime mapping', () => {
    test('eight distinct emotes map to eight distinct buttons', () => {
        const indices = Object.values(MIME_EMOTE_BY_SEQ);
        expect(new Set(indices).size).toBe(8);
        expect(MIME_IF.buttons).toHaveLength(8);
    });
    test('answers the seen emote', () => {
        expect(mimeAnswer(866)).toBe(3);
        expect(mimeAnswer(1131)).toBe(7);
    });
    test('null for unknown/none (bow, cheer, idle)', () => {
        expect(mimeAnswer(858)).toBeNull();
        expect(mimeAnswer(862)).toBeNull();
        expect(mimeAnswer(null)).toBeNull();
    });
});
