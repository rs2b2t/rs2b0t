import { expect, test } from 'bun:test';
import type { BrowserContext } from 'playwright-core';
import { privatePage, routePrivateHttp, routePrivateSocket } from '../../e2e/jive-private-session.js';

function browserFixture() {
    const actions: string[] = [];
    const grants: { permissions: string[]; origin: string | undefined }[] = [];
    const page = { marker: 'private-page' };
    const context = {
        async grantPermissions(permissions: string[], options?: { origin?: string }) {
            actions.push('grant'); grants.push({ permissions, origin: options?.origin });
        },
        async route(pattern: Parameters<BrowserContext['route']>[0], handler: Parameters<BrowserContext['route']>[1]): ReturnType<BrowserContext['route']> {
            expect(pattern).toBe('**/*'); expect(handler).toBe(routePrivateHttp); actions.push('http-guard');
            let registered = true;
            const dispose = async () => {
                if (registered) { registered = false; actions.push('http-unguard'); }
            };
            return { dispose, [Symbol.asyncDispose]: dispose };
        },
        async routeWebSocket(pattern: Parameters<BrowserContext['routeWebSocket']>[0], handler: Parameters<BrowserContext['routeWebSocket']>[1]) {
            expect(pattern).toEqual(/.*/); expect(handler).toBe(routePrivateSocket); actions.push('ws-guard');
        },
        async newPage() { actions.push('page'); return page; },
    };
    const browser = { async newContext(options: { serviceWorkers: 'block' }) {
        expect(options).toEqual({ serviceWorkers: 'block' }); actions.push('context'); return context;
    } };
    return { browser, context, page, actions, grants };
}

test('grants only local-network-access to private origin before creating the page', async () => {
    const h = browserFixture();
    const page = await privatePage(h.browser);
    expect(h.grants).toEqual([{ permissions: ['local-network-access'], origin: 'http://localhost:8891' }]);
    expect(h.actions).toEqual(['context', 'grant', 'http-guard', 'ws-guard', 'page']);
    expect(page).toBe(h.page);
});

test('awaits the scoped grant before a page can create workers', async () => {
    const h = browserFixture(), entered = Promise.withResolvers<void>(), granted = Promise.withResolvers<void>();
    const original = h.context.grantPermissions;
    h.context.grantPermissions = async (...args) => { await original(...args); entered.resolve(); await granted.promise; };
    const opening = privatePage(h.browser);
    try { await entered.promise; expect(h.actions).toEqual(['context', 'grant']); }
    finally { granted.resolve(); await opening; }
    expect(h.actions.at(-1)).toBe('page');
});

test('does not create a page when the scoped permission is refused', async () => {
    const h = browserFixture(), failure = new Error('permission unsupported');
    h.context.grantPermissions = async () => { throw failure; };
    await expect(privatePage(h.browser)).rejects.toBe(failure);
    expect(h.actions).toEqual(['context']);
});

test('route registration exposes both Playwright disposal methods', async () => {
    const h = browserFixture();

    const registration = await h.context.route('**/*', routePrivateHttp);

    expect(registration).toMatchObject({ dispose: expect.any(Function), [Symbol.asyncDispose]: expect.any(Function) });
});

test.each(['ws://localhost:8890/', 'ws://localhost:43596/', 'ws://localhost:8899/', 'ws://127.0.0.1:8891/', 'wss://localhost:8891/', 'ws://external.test:8891/'])('retains rejection of %s after granting the private origin', async url => {
    const h = browserFixture(); await privatePage(h.browser);
    const effects: string[] = [];
    await routePrivateSocket({ url: () => url, close: async () => { effects.push('closed'); }, connectToServer: () => { effects.push('connected'); } });
    expect(effects).toEqual(['closed']);
});
