import { expect, test } from 'bun:test';

import { cacheUrl, resolveTarget } from '#/config/target.js';

test('live target forces the rs2b2t host and TLS, ignoring the serving origin', () => {
    const t = resolveTarget('live', 'localhost:8890', false);
    expect(t.wsHost).toBe('w1.rs2b2t.com');
    expect(t.tls).toBe(true);
});

test('local target uses the serving origin and its scheme', () => {
    const t = resolveTarget('local', 'localhost:8890', false);
    expect(t.wsHost).toBe('localhost:8890');
    expect(t.tls).toBe(false);
});

test('an https local origin selects a secure socket', () => {
    const t = resolveTarget('local', 'example.test', true);
    expect(t.tls).toBe(true);
});

test('prod target resolves same-origin (like local), NOT a hardcoded host', () => {
    expect(resolveTarget('prod', 'w1.rs2b2t.com', true)).toEqual({ wsHost: 'w1.rs2b2t.com', tls: true, cacheHost: '' });
    expect(resolveTarget('prod', 'localhost:8890', false)).toEqual({ wsHost: 'localhost:8890', tls: false, cacheHost: '' });
});

test('only the pages target names a cache host — everyone else stays same-origin', () => {
    expect(resolveTarget('pages', 'dginovker.github.io', true).cacheHost).toBe('w1.rs2b2t.com');
    for (const name of ['local', 'live', 'prod']) {
        expect(resolveTarget(name, 'dginovker.github.io', true).cacheHost).toBe('');
    }
});

test('pages target talks to rs2b2t for both the game socket and the cache', () => {
    const t = resolveTarget('pages', 'dginovker.github.io', true);
    expect(t).toEqual({ wsHost: 'w1.rs2b2t.com', tls: true, cacheHost: 'w1.rs2b2t.com' });
});

test('a pages build addresses the cache absolutely; every other build stays relative', () => {
    expect(cacheUrl('/crc', resolveTarget('pages', 'dginovker.github.io', true))).toBe('https://w1.rs2b2t.com/crc');
    expect(cacheUrl('/title1234', resolveTarget('pages', 'dginovker.github.io', true))).toBe('https://w1.rs2b2t.com/title1234');
    for (const name of ['local', 'live', 'prod']) {
        expect(cacheUrl('/crc', resolveTarget(name, 'localhost:8890', false))).toBe('/crc');
    }
});
