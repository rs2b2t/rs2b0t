import { describe, expect, test } from 'bun:test';

import { isNavV2, parseNavEngine, resolveNavEngine } from '#/bot/nav/navEngine.js';

describe('navEngine toggle', () => {
    test('parseNavEngine accepts aliases', () => {
        expect(parseNavEngine('classic')).toBe('classic');
        expect(parseNavEngine('v1')).toBe('classic');
        expect(parseNavEngine('v2')).toBe('v2');
        expect(parseNavEngine('nav-v2')).toBe('v2');
        expect(parseNavEngine(true)).toBe('v2');
        expect(parseNavEngine(false)).toBe('classic');
        expect(parseNavEngine('nope')).toBeNull();
    });

    test('explicit override wins over default classic', () => {
        expect(resolveNavEngine('v2')).toBe('v2');
        expect(resolveNavEngine('classic')).toBe('classic');
        expect(isNavV2('v2')).toBe(true);
        expect(isNavV2('classic')).toBe(false);
    });

    test('default without storage is classic', () => {
        // Node unit context: no localStorage Global override → classic
        expect(resolveNavEngine(undefined)).toBe('classic');
        expect(isNavV2(undefined)).toBe(false);
    });
});
