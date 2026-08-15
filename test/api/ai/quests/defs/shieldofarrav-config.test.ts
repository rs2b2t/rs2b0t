import { describe, expect, test } from 'bun:test';

import { ArravConfig, hashName, resolveGang } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';

describe('arrav gang selection', () => {
    test('an explicit setting is returned unchanged', () => {
        expect(resolveGang('phoenix', 'anyone')).toBe('phoenix');
        expect(resolveGang('blackarm', 'anyone')).toBe('blackarm');
    });

    test('random is stable for one name across calls', () => {
        const first = resolveGang('random', 'Zezima');
        for (let i = 0; i < 20; i++) {
            expect(resolveGang('random', 'Zezima')).toBe(first);
        }
    });

    test('random ignores case, spaces and underscores', () => {
        expect(resolveGang('random', 'Jon Snow')).toBe(resolveGang('random', 'jon_snow'));
        expect(resolveGang('random', 'JONSNOW')).toBe(resolveGang('random', 'jonsnow'));
    });

    test('random splits a population of names across both gangs', () => {
        const names = Array.from({ length: 200 }, (_, i) => `bot${i}`);
        const phoenix = names.filter(n => resolveGang('random', n) === 'phoenix').length;
        expect(phoenix).toBeGreaterThan(60);
        expect(phoenix).toBeLessThan(140);
    });

    test('random falls back to phoenix when the name is not known yet', () => {
        expect(resolveGang('random', null)).toBe('phoenix');
        expect(resolveGang('random', '')).toBe('phoenix');
    });

    test('hashName is a 32-bit unsigned value', () => {
        expect(hashName('a')).toBeGreaterThanOrEqual(0);
        expect(hashName('a')).toBeLessThan(2 ** 32);
        expect(hashName('a')).not.toBe(hashName('b'));
    });

    test('the config defaults match the documented settings', () => {
        expect(ArravConfig.gang).toBe('random');
        expect(ArravConfig.partner).toBe('');
        expect(ArravConfig.certTarget).toBe(2);
    });
});
