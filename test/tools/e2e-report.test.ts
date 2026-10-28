import { describe, expect, test } from 'bun:test';

import { driftVerdict, errorTail } from '../../tools/lib/e2e-report.js';

describe('errorTail', () => {
    test('prefers the error line over the stack footer that follows it', () => {
        const out = errorTail([
            '  boot: loading --no-deploy/bot.html',
            'error: goto: Protocol error (Page.navigate): Cannot navigate to invalid URL',
            '      at bootAndLogin (/repo/tools/tutorial/harness.ts:108:16)',
            'Bun v1.3.14 (macOS arm64)'
        ]);
        expect(out).toContain('Cannot navigate to invalid URL');
        expect(out.startsWith('at bootAndLogin')).toBe(false);
    });

    test('a FAIL: assertion counts as the error', () => {
        const out = errorTail([
            'final: truck=110 xp=+5550',
            'FAIL: junk still held after banking: Coins, Bones',
            'closing browser'
        ]);
        expect(out).toContain('FAIL: junk still held after banking');
    });

    test('falls back to the last lines when nothing looks like an error', () => {
        expect(errorTail(['a', 'b', 'c', 'd'])).toBe('b | c | d');
    });

    test('blank lines never reach the output', () => {
        expect(errorTail(['a', '   ', '', 'b'])).toBe('a | b');
    });

    test('caps at 240 characters', () => {
        expect(errorTail([`error: ${'x'.repeat(500)}`]).length).toBe(240);
    });

    test('empty input is an empty string, not a crash', () => {
        expect(errorTail([])).toBe('');
    });
});

describe('driftVerdict', () => {
    test.each([
        ['ok: src/bot/api/ai/clues/data/cluedb.ts matches the content pack', 'cluedb'],
        ['src/bot/data/dropdb.ts is up to date', 'dropdb'],
        ['src/bot/data/spelldb.ts is up to date', 'spelldb'],
        ['ok: src/bot/data/itemdb.ts matches the content pack', 'itemdb'],
        ['ok: src/bot/data/shopdb.ts matches the content pack', 'shopdb'],
        ['scripts=68\nok: docs/SCRIPTS.md matches the registry', 'scriptdocs']
    ])('a clean report passes (%s)', (text: string) => {
        expect(driftVerdict(text)).toBe('pass');
    });

    test('STALE fails even alongside an earlier ok: line', () => {
        expect(driftVerdict('ok: one.ts matches\nSTALE: two.ts does not match the registry')).toBe('fail');
    });

    test('a crash before the tool prints anything fails rather than passing', () => {
        const crash = [
            "TypeError: undefined is not an object (evaluating 'window.audioContext.createGain')",
            '      at /repo/src/client/3rdparty/tinymidipcm.js:153:27',
            'Bun v1.3.14 (macOS arm64)'
        ].join('\n');
        expect(driftVerdict(crash)).toBe('fail');
    });

    test('empty output fails rather than passing', () => {
        expect(driftVerdict('')).toBe('fail');
    });
});
