import { expect, test } from 'bun:test';

import { resolveTarget } from '#/config/target.js';

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
