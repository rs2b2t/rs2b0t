import { describe, expect, test } from 'bun:test';

import { parseArgs, positionalArgs } from '../../e2e/lib/harness.js';

describe('parseArgs', () => {
    test('url-first: base URL then minutes', () => {
        expect(parseArgs(['http://localhost:8890', '4'])).toEqual({ base: 'http://localhost:8890', minutes: 4, rest: [] });
    });

    test('minutes-first: minutes then base URL (same result — order-independent)', () => {
        expect(parseArgs(['4', 'http://localhost:8890'])).toEqual({ base: 'http://localhost:8890', minutes: 4, rest: [] });
    });

    test('the sweep case: a lone base URL is the base, not NaN minutes (uses caller minutes default)', () => {
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

    test('the runner\'s global flags never reach rest — rest is a scenario filter', () => {
        expect(parseArgs(['--no-deploy'])).toEqual({ base: 'http://localhost:8890', minutes: 0, rest: [] });
    });

    test('a real filter survives alongside a global flag', () => {
        expect(parseArgs(['--no-deploy', 'mine-bank'])).toEqual({
            base: 'http://localhost:8890',
            minutes: 0,
            rest: ['mine-bank']
        });
    });
});

describe('positionalArgs', () => {
    const FB = 'http://localhost:8890';

    test('the runner case: a lone --no-deploy leaves the fallback base at index 0', () => {
        expect(positionalArgs(['--no-deploy'], FB)).toEqual([FB]);
    });

    test('a positional base is kept at index 0', () => {
        expect(positionalArgs(['http://localhost:8888', 'user1'], FB)).toEqual(['http://localhost:8888', 'user1']);
    });

    test('later positionals keep their index when the base is absent', () => {
        expect(positionalArgs(['--no-deploy', 'user1', 'soak'], FB)).toEqual([FB, 'user1', 'soak']);
    });

    test('--base wins over the fallback and stays at index 0', () => {
        expect(positionalArgs(['--base', 'http://localhost:9999', 'user1'], FB)).toEqual([
            'http://localhost:9999',
            'user1'
        ]);
    });

    test('--base wins over a positional base too', () => {
        expect(positionalArgs(['http://localhost:8888', '--base', 'http://localhost:9999'], FB)).toEqual([
            'http://localhost:9999'
        ]);
    });

    test('the value of a value-taking flag is not mistaken for a positional', () => {
        expect(positionalArgs(['--minutes', '5', 'user1'], FB)).toEqual([FB, 'user1']);
    });

    test('short flags are stripped as well', () => {
        expect(positionalArgs(['-v', 'user1'], FB)).toEqual([FB, 'user1']);
    });

    test('ordering is preserved across many positionals', () => {
        expect(positionalArgs(['http://h:1', 'user1', 'a', 'b', 'c'], FB)).toEqual([
            'http://h:1',
            'user1',
            'a',
            'b',
            'c'
        ]);
    });
});
