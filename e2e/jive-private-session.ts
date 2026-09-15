import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from 'playwright-core';
import { assertPrivateUrl, candidateRoot, privateEngine } from './jive-private-boundary.mjs';
import { cheatQuiet, relog } from './tutorial/harness.js';
import { parsePrivateFrame } from './jive-private-server.js';

type HttpRoute = {
    request(): { url(): string; redirectedFrom(): unknown };
    fetch(options: { maxRedirects: number; timeout: number }): Promise<{ status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }>;
    abort(): Promise<void>;
    fulfill(options: { status: number; headers: Record<string, string>; body: Buffer }): Promise<void>;
};

export async function routePrivateHttp(route: HttpRoute) {
    try { assertPrivateUrl(route.request().url()); assert(!route.request().redirectedFrom()); }
    catch (error) { if (!(error instanceof Error)) throw error; await route.abort(); return; }
    const response = await route.fetch({ maxRedirects: 0, timeout: 15000 });
    if (response.status() >= 300 && response.status() < 400) { await route.abort(); return; }
    await route.fulfill({ status: response.status(), headers: response.headers(), body: await response.body() });
}

export async function routePrivateSocket(socket: { url(): string; close(): Promise<void>; connectToServer(): unknown }) {
    try { assertPrivateUrl(socket.url(), 'ws:'); }
    catch (error) { if (!(error instanceof Error)) throw error; await socket.close(); return; }
    socket.connectToServer();
}

type PrivateBrowser<P> = {
    newContext(options: { serviceWorkers: 'block' }): Promise<Pick<BrowserContext, 'grantPermissions' | 'route' | 'routeWebSocket'> & { newPage(): Promise<P> }>;
};

export async function privatePage<P>(browser: PrivateBrowser<P>): Promise<P> {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.grantPermissions(['local-network-access'], { origin: 'http://localhost:8891' });
    await context.route('**/*', routePrivateHttp);
    await context.routeWebSocket(/.*/, routePrivateSocket);
    return context.newPage();
}

export async function fetchPrivate(url: URL) {
    assertPrivateUrl(url.href);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert(response.ok, 'private HTTP request failed');
    return response;
}

function observerPresence(value: unknown) {
    assert(typeof value === 'object' && value !== null);
    assert('at' in value && typeof value.at === 'number' && Number.isFinite(value.at));
    assert('engine' in value && value.engine === privateEngine);
    assert('candidate' in value && value.candidate === candidateRoot);
    assert('players' in value && Array.isArray(value.players));
    const players = value.players.map((p: unknown) => {
        assert(typeof p === 'object' && p !== null && 'username' in p && typeof p.username === 'string');
        return p.username;
    });
    assert(value.at <= Date.now() && Date.now() - value.at < 1000, 'fresh private observer required');
    return { at: value.at, players };
}

export async function requirePrivateAccount<T>(frame: unknown, user: string, mutate: () => Promise<T>) {
    const current = observerPresence(frame);
    assert.deepEqual(current.players, [user], 'private account must be the only observed player before mutation');
    return mutate();
}

async function lastFrame(server: string): Promise<unknown> {
    const line = (await readFile(server, 'utf8')).split('\n').slice(0, -1).filter(Boolean).at(-1);
    assert(line, 'complete private observer frame required');
    return JSON.parse(line);
}

export async function privateMutation<T>(server: string, user: string, mutate: () => Promise<T>) {
    return requirePrivateAccount(await lastFrame(server), user, mutate);
}

export async function confirmPrivateTrail(server: string, setup: { readonly user: string; readonly since: number; readonly trailStatus: number }) {
    const value = await lastFrame(server);
    await requirePrivateAccount(value, setup.user, async () => {
        const frame = parsePrivateFrame(value);
        assert(frame.at >= setup.since, 'private trail frame must follow fixture setup');
        assert.equal(frame.players.find(p => p.username === setup.user)?.trailStatus, setup.trailStatus, 'private trail state mismatch');
    });
}

export async function privateMainland(page: Page, account: { readonly user: string; readonly pagePath: string; readonly server: string }) {
    const { user, pagePath, server } = account;
    const empty = observerPresence(await lastFrame(server));
    assert.equal(empty.players.length, 0, 'empty private world required before login');
    const url = assertPrivateUrl(new URL(pagePath, 'http://localhost:8891').href);
    url.searchParams.set('nodeid', '10');
    await page.goto(url.href);
    await page.waitForFunction(() => {
        const constructor = globalThis.rs2b0t?.client.constructor;
        return constructor && 'loopCycle' in constructor && typeof constructor.loopCycle === 'number' && constructor.loopCycle > 10;
    }, undefined, { timeout: 180000 });
    await page.evaluate(async u => {
        const client = globalThis.rs2b0t.client;
        if (!('login' in client) || typeof client.login !== 'function') throw new Error('client login API missing');
        Object.assign(client, { loginUser: u, loginPass: 'test' });
        await client.login(u, 'test', false);
    }, user);
    await page.waitForFunction(() => {
        const client = globalThis.rs2b0t.client;
        return client.ingame && 'sceneState' in client && client.sceneState === 2;
    }, undefined, { timeout: 120000 });
    await privateMutation(server, user, async () => { assert(await cheatQuiet(page, 'tele 0,50,50,20,20')); });
    await privateMutation(server, user, async () => { assert(await cheatQuiet(page, 'setvar tutorial 1000')); });
    await relog(page, user);
    await privateMutation(server, user, async () => {});
}

export async function cleanupPrivate(steps: readonly (() => Promise<unknown>)[]) {
    const failures: unknown[] = [];
    for (const step of steps) {
        try { await step(); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new AggregateError(failures, 'private cleanup failed');
}

export async function confirmPrivateDisconnect(server: string, user: string) {
    const since = Date.now(), deadline = since + 30000;
    while (Date.now() < deadline) {
        const frame = observerPresence(await lastFrame(server));
        if (frame.at >= since && !frame.players.includes(user)) return { user, serverAt: frame.at, present: false };
        await Bun.sleep(200);
    }
    assert.fail('fresh private observer did not confirm disconnect');
}
