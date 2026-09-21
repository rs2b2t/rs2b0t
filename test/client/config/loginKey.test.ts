import { afterEach, expect, test } from 'bun:test';

import { extractLoginModulus, loginExponent, loginModulus, parseLoginModulus, refreshLoginKey, resetLoginKey } from '#/client/config/loginKey.js';

const MODULUS_A = '1'.repeat(309);
const MODULUS_B = '2'.repeat(309);

const realFetch = globalThis.fetch;

function stubFetch(impl: (input: string) => Promise<Response>): void {
    globalThis.fetch = impl as unknown as typeof fetch;
}

function serveByUrl(routes: Record<string, { body: string; ok?: boolean }>): void {
    stubFetch(async (input: string) => {
        const route = routes[input];
        return route ? new Response(route.body, { status: route.ok === false ? 404 : 200 }) : new Response('missing', { status: 404 });
    });
}

function serve(body: string, ok = true): void {
    stubFetch(async () => new Response(body, { status: ok ? 200 : 404 }));
}

afterEach(() => {
    globalThis.fetch = realFetch;
    resetLoginKey();
});

test('a 1024-bit modulus parses; noise does not', () => {
    expect(parseLoginModulus(`  ${MODULUS_A}\n`)).toBe(MODULUS_A);
    expect(parseLoginModulus('not found')).toBeNull();
    expect(parseLoginModulus('1234567890')).toBeNull();
    expect(parseLoginModulus(`${MODULUS_A} trailing`)).toBeNull();
});

test('a rotated key is adopted and reported as changed', async () => {
    serve(MODULUS_A);
    expect(await refreshLoginKey()).toBe(true);
    expect(loginModulus()).toBe(BigInt(MODULUS_A));

    serve(MODULUS_B);
    expect(await refreshLoginKey()).toBe(true);
    expect(loginModulus()).toBe(BigInt(MODULUS_B));
});

test('an unchanged key reports no change, so the retry cannot loop', async () => {
    serve(MODULUS_A);
    expect(await refreshLoginKey()).toBe(true);
    expect(await refreshLoginKey()).toBe(false);
});

test('a missing /loginkey route leaves the baked key alone', async () => {
    serve('unavailable', false);
    expect(await refreshLoginKey()).toBe(false);
});

test('a garbage body leaves the baked key alone', async () => {
    serve('<!doctype html><title>404</title>');
    expect(await refreshLoginKey()).toBe(false);
});

test('a network failure leaves the baked key alone', async () => {
    stubFetch(async () => {
        throw new Error('offline');
    });
    expect(await refreshLoginKey()).toBe(false);
});

test('the exponent stays the standard 65537', () => {
    expect(loginExponent()).toBe(65537n);
});

test('the anchored parser rejects a bundle the extractor accepts', () => {
    const bundle = `var t=${MODULUS_A};function e(){}`;
    expect(parseLoginModulus(bundle)).toBeNull();
    expect(extractLoginModulus(bundle)).toBe(MODULUS_A);
    expect(extractLoginModulus('no digits here')).toBeNull();
    expect(extractLoginModulus('12345')).toBeNull();
});

test('a missing /loginkey falls back to the same-origin client bundle', async () => {
    serveByUrl({
        '/loginkey': { body: 'not found', ok: false },
        '/client/client.js': { body: `var t=${MODULUS_B};` }
    });
    expect(await refreshLoginKey()).toBe(true);
    expect(loginModulus()).toBe(BigInt(MODULUS_B));
});

test('/loginkey wins when both answer', async () => {
    serveByUrl({
        '/loginkey': { body: MODULUS_A },
        '/client/client.js': { body: `var t=${MODULUS_B};` }
    });
    expect(await refreshLoginKey()).toBe(true);
    expect(loginModulus()).toBe(BigInt(MODULUS_A));
});

test('both sources failing leaves the baked key alone', async () => {
    serveByUrl({});
    expect(await refreshLoginKey()).toBe(false);
});

test('each frame refreshes only its selected world key and client bundle', async () => {
    const paths: string[] = [];
    stubFetch(async path => {
        paths.push(path);
        return path.endsWith('/client/client.js') ? new Response(`const modulus=${MODULUS_A}`) : new Response('missing', { status: 404 });
    });
    expect(await refreshLoginKey({ wsHost: 'localhost:8081/__rs2b0t/world/2', tls: false, world: 2, httpPrefix: '/__rs2b0t/world/2' })).toBe(true);
    expect(paths).toEqual(['/__rs2b0t/world/2/loginkey', '/__rs2b0t/world/2/client/client.js']);
});
