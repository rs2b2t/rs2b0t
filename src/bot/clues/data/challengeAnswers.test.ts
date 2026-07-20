import { describe, expect, test } from 'bun:test';
import { CHALLENGE_ANSWERS, challengeAnswer } from './challengeAnswers.js';

describe('challengeAnswer', () => {
    // Keyed by the held anagram clue's obj id (== talk step.id), not the closed
    // prompt text. Ids mirror pack/obj.pack + CLUE_DB's talk rows.
    test('zoo animals — anagram003 (Zoo keeper)', () => {
        expect(challengeAnswer(2845)).toBe(40);
    });
    test('19 to the power of 3 — anagram001 (Hazelmere)', () => {
        expect(challengeAnswer(2841)).toBe(6859);
    });
    test('Lumbridge cannons — anagram002 (Cook)', () => {
        expect(challengeAnswer(2843)).toBe(9);
    });
    test('16 kebabs shared — anagram006 (Kebab seller)', () => {
        expect(challengeAnswer(2849)).toBe(5);
    });
    test('3x + y — anagram007 (Oracle)', () => {
        expect(challengeAnswer(2851)).toBe(48);
    });
    test('57 x 89 + 23 — anagram008 (Gnome ball referee)', () => {
        expect(challengeAnswer(2853)).toBe(5096);
    });
    test('a non-challenge clue id → null (leave the dialog alone)', () => {
        expect(challengeAnswer(2847)).toBeNull(); // anagram004 has no _challenge scroll
        expect(challengeAnswer(0)).toBeNull();
    });
});

describe('CHALLENGE_ANSWERS table', () => {
    test('covers the six challenge clues with unique ids', () => {
        expect(CHALLENGE_ANSWERS).toHaveLength(6);
        expect(new Set(CHALLENGE_ANSWERS.map(c => c.id)).size).toBe(6);
    });
    test('every row is a medium anagram clue with a positive integer answer', () => {
        for (const c of CHALLENGE_ANSWERS) {
            expect(c.clue).toMatch(/^trail_clue_medium_anagram\d+$/);
            expect(Number.isInteger(c.answer)).toBe(true);
            expect(c.answer).toBeGreaterThan(0);
        }
    });
});
