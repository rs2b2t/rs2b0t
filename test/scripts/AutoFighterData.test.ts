import { describe, expect, test } from 'bun:test';
import { DEFAULT_LOOT, SPOTS, SPOT_OPTIONS, TARGET_OPTIONS } from '#/bot/scripts/AutoFighterData.js';

describe('AutoFighter data', () => {
    test('loot defaults to exactly gems + clues (the spec set)', () => {
        expect(DEFAULT_LOOT).toEqual([
            'clue scroll',
            'uncut sapphire', 'uncut emerald', 'uncut ruby', 'uncut diamond',
            'half of a key',
            'chaos talisman', 'nature talisman'
        ]);
    });
    test('every spot option resolves to a spot with a sane leash', () => {
        expect(SPOT_OPTIONS.length).toBe(10);
        for (const name of SPOT_OPTIONS) {
            const s = SPOTS[name];
            expect(s).toBeDefined();
            expect(s.leash).toBeGreaterThanOrEqual(6);
            expect(s.leash).toBeLessThanOrEqual(14);
        }
    });
    test('Guard is the only target for now', () => {
        expect(TARGET_OPTIONS).toEqual(['Guard']);
    });
});
