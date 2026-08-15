import { describe, expect, test } from 'bun:test';
import { flagValue, hasFlag } from '#/bot/api/ai/quests/engine/types.js';

describe('quest progress flags', () => {
    test('hasFlag finds a set flag and misses an unset one', () => {
        const progress = { stage: 2, flags: new Set(['helped-og']) };
        expect(hasFlag(progress, 'helped-og')).toBe(true);
        expect(hasFlag(progress, 'helped-grew')).toBe(false);
    });

    test('hasFlag on an absent progress is false, never a throw', () => {
        expect(hasFlag(undefined, 'helped-og')).toBe(false);
    });

    test('flagValue reads the numeric tail of a "name:N" flag', () => {
        const progress = { stage: 10, flags: new Set(['shamans-left:4']) };
        expect(flagValue(progress, 'shamans-left')).toBe(4);
    });

    test('flagValue is undefined when the flag is absent', () => {
        const progress = { stage: 10, flags: new Set<string>() };
        expect(flagValue(progress, 'shamans-left')).toBeUndefined();
    });

    test('flagValue reads zero, which must not be confused with absent', () => {
        const progress = { stage: 10, flags: new Set(['shamans-left:0']) };
        expect(flagValue(progress, 'shamans-left')).toBe(0);
    });
});
