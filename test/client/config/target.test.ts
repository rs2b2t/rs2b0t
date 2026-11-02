import { expect, test } from 'bun:test';

import { resolveTarget, supportsWorldRouting } from '#/client/config/target.js';

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
    expect(resolveTarget('prod', 'w1.rs2b2t.com', true)).toEqual({ wsHost: 'w1.rs2b2t.com', tls: true });
    expect(resolveTarget('prod', 'localhost:8890', false)).toEqual({ wsHost: 'localhost:8890', tls: false });
});

test('World 2 prod sockets use World 2 independently of the build machine', () => {
    expect(resolveTarget('prod', 'w2.rs2b2t.com', true)).toEqual({ wsHost: 'w2.rs2b2t.com', tls: true });
});

test('explicit live/proxy/prod frames route game and cache sockets through their world prefix', () => {
    for (const name of ['live', 'proxy', 'prod']) {
        for (const world of [1, 2, 3] as const) {
            const target = resolveTarget(name, 'localhost:8081', false, new URLSearchParams(`world=${world}`));
            expect(target).toEqual({ wsHost: `localhost:8081/__rs2b0t/world/${world}`, tls: false, world, httpPrefix: `/__rs2b0t/world/${world}` });
        }
        expect(() => resolveTarget(name, 'localhost:8081', false, new URLSearchParams('world=4'))).toThrow();
    }
});


test('world assignment is available only in builds with live routing', () => {
    for (const name of ['live', 'proxy', 'prod']) expect(supportsWorldRouting(name)).toBe(true);
    for (const name of ['local', '', 'unknown']) expect(supportsWorldRouting(name)).toBe(false);
});
