import { describe, expect, test } from 'bun:test';

import { PROTECT_LEVEL, shouldProtect } from '#/bot/api/ai/quests/defs/holygrail/legs.js';

describe('shouldProtect', () => {
    test('arms melee protection at the prayer level that unlocks it', () => {
        expect(shouldProtect(PROTECT_LEVEL, 43, false)).toBe(true);
    });

    test('a character below the level never arms it', () => {
        expect(shouldProtect(PROTECT_LEVEL - 1, 42, false)).toBe(false);
    });

    test('an empty prayer bar spends no tick on the button', () => {
        expect(shouldProtect(70, 0, false)).toBe(false);
    });

    test('a prayer already up is left alone', () => {
        expect(shouldProtect(70, 70, true)).toBe(false);
    });

    test('a character with no prayer levels never arms it', () => {
        expect(shouldProtect(0, 0, false)).toBe(false);
    });
});
