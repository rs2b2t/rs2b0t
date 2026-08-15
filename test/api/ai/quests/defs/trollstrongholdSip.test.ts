import { describe, expect, test } from 'bun:test';
import { needsSip } from '#/bot/api/ai/quests/defs/trollstronghold/combat.js';

describe('needsSip', () => {
    test('sips below half the bar', () => {
        expect(needsSip(34, 70)).toBe(true);
    });

    test('leaves a bar at half alone', () => {
        expect(needsSip(35, 70)).toBe(false);
    });

    test('leaves a full bar alone', () => {
        expect(needsSip(70, 70)).toBe(false);
    });

    test('sips at empty', () => {
        expect(needsSip(0, 70)).toBe(true);
    });

    test('a character with no prayer levels never sips', () => {
        expect(needsSip(0, 0)).toBe(false);
    });
});
