import { describe, expect, test } from 'bun:test';

import { parseArgs } from '../../tools/lib/harness.js';

describe('parseArgs', () => {
    test('url-first: base URL then minutes', () => {
        expect(parseArgs(['http://localhost:8890', '4'])).toEqual({ base: 'http://localhost:8890', minutes: 4, rest: [] });
    });

    test('minutes-first: minutes then base URL (same result — order-independent)', () => {
        expect(parseArgs(['4', 'http://localhost:8890'])).toEqual({ base: 'http://localhost:8890', minutes: 4, rest: [] });
    });

    test('the sweep case: a lone base URL is the base, not NaN minutes (uses caller minutes default)', () => {
        // run-all-smokes spawns `bun tools/<name> <base>`; a minutes-first smoke
        // used to parse that URL as minutes -> NaN deadline + wrong port.
        expect(parseArgs(['http://localhost:8890'], { base: 'http://localhost:8888', minutes: 8 })).toEqual({
            base: 'http://localhost:8890',
            minutes: 8,
            rest: []
        });
    });

    test('--base and --minutes flags', () => {
        expect(parseArgs(['--minutes', '2.5', '--base', 'http://localhost:9999'])).toEqual({
            base: 'http://localhost:9999',
            minutes: 2.5,
            rest: []
        });
    });

    test('flags win regardless of position', () => {
        expect(parseArgs(['--base', 'http://example.com:1234', '--minutes', '10'])).toEqual({
            base: 'http://example.com:1234',
            minutes: 10,
            rest: []
        });
    });

    test('defaults: empty argv falls back to caller defaults', () => {
        expect(parseArgs([], { base: 'http://localhost:8890', minutes: 18 })).toEqual({
            base: 'http://localhost:8890',
            minutes: 18,
            rest: []
        });
    });

    test('defaults: no argv and no caller defaults -> 8890 / 0', () => {
        expect(parseArgs([])).toEqual({ base: 'http://localhost:8890', minutes: 0, rest: [] });
    });

    test('caller minutes default kept when only a base is given', () => {
        expect(parseArgs(['http://localhost:8890'], { minutes: 18 })).toEqual({
            base: 'http://localhost:8890',
            minutes: 18,
            rest: []
        });
    });

    test('rest passthrough: non-URL, non-numeric args (e.g. username) collect in rest', () => {
        expect(parseArgs(['http://localhost:8890', '4', 'crab123abc'])).toEqual({
            base: 'http://localhost:8890',
            minutes: 4,
            rest: ['crab123abc']
        });
    });

    test('rest passthrough: a mode arg with minutes-first ordering', () => {
        expect(parseArgs(['18', 'http://localhost:8890', 'soak'])).toEqual({
            base: 'http://localhost:8890',
            minutes: 18,
            rest: ['soak']
        });
    });

    test('a wss:// url (contains ://) is treated as the base', () => {
        expect(parseArgs(['wss://w1.example.com/'])).toEqual({ base: 'wss://w1.example.com/', minutes: 0, rest: [] });
    });
});
