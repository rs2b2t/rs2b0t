import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import type { SettingsStore } from '../src/bot/runtime/Settings.js';

if (process.versions.bun) {
    const child = Bun.spawn(['node', import.meta.path], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    process.exit(await child.exited);
}

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const profile = mkdtempSync(join(tmpdir(), 'rs2b0t-storage-ipc-e2e-'));
const server = createServer((request, response) => {
    if (request.url === '/storage.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(readFileSync(join(profile, 'storage.js')));
        return;
    }
    response.setHeader('Content-Type', 'text/html');
    const script = request.url?.startsWith('/fallback.html')
        ? '<script type="module">import "/storage.js"; window.storageReady = true; window.storageEvents = 0; addEventListener("storage", () => window.storageEvents++);</script>'
        : '';
    response.end(`<!doctype html><title>Storage IPC fixture</title><body>Storage IPC fixture${script}</body>`);
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert(address && typeof address !== 'string');
const url = `http://127.0.0.1:${address.port}/multibox.html`;
const key = 'rs2b0t:set:IPC:state';
let app: ElectronApplication | undefined;
let stderr = '';

async function synced(page: Page, value: string | null) {
    await page.waitForFunction(({ key, value }) => {
        const frames = ['first', 'second'].map(id => document.querySelector<HTMLIFrameElement>(`#${id}`)?.contentWindow);
        return [window, ...frames].every(win => win?.rs2b0tDesktopStorage?.getItem(key) === value);
    }, { key, value });
}

async function verifyFallbackStorage(app: ElectronApplication) {
    const fixture = join(profile, 'storage.ts');
    writeFileSync(fixture, `import ${JSON.stringify(join(root, 'src/bot/panel/desktopStorage.ts'))};
import { SettingsStore } from ${JSON.stringify(join(root, 'src/bot/runtime/Settings.ts'))};
Reflect.set(globalThis, 'fixtureSettings', SettingsStore);`);
    execFileSync('bun', ['build', fixture, '--target=browser', '--outfile', join(profile, 'storage.js')], { cwd: root });
    const opened = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }, { url, preload }) => {
        const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, backgroundThrottling: false, nodeIntegrationInSubFrames: false } });
        await window.loadURL(url);
    }, { url: new URL('/fallback.html?box=fixture', url).href, preload: join(root, 'desktop/preload.cjs') });
    const page = await opened;
    try {
        await page.waitForFunction(() => Reflect.get(window, 'storageReady'));
        await page.evaluate(async () => {
            await Promise.all(['first', 'second', 'third', 'fourth', 'fifth'].map(id => new Promise<void>(resolve => {
                const frame = document.createElement('iframe');
                frame.id = id;
                frame.src = `/fallback.html?box=fixture&id=${id}`;
                frame.onload = () => resolve();
                document.body.append(frame);
            })));
        });
        await page.waitForFunction(() => Array.from(document.querySelectorAll('iframe')).every(frame => Reflect.get(frame.contentWindow!, 'storageReady')));
        assert.deepEqual(await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(frame => !!frame.contentWindow!.rs2b0tDesktopStorage)), [false, false, false, false, false]);
        const setting = 'rs2b0t:fixture:set:Superheater:natures';
        await page.evaluate(() => {
            const frame = document.querySelector<HTMLIFrameElement>('#first')!.contentWindow!;
            const settings = Reflect.get(frame, 'fixtureSettings') as typeof SettingsStore;
            for (const value of ['10', '20', '30']) settings.save('Superheater', 'natures', value);
        });
        await page.waitForTimeout(500);
        const snapshot = () => page.evaluate(key => [window, ...Array.from(document.querySelectorAll('iframe')).map(frame => frame.contentWindow!)].map(win => ({
            durable: win.localStorage.getItem(key),
            session: win.sessionStorage.getItem(key),
            events: Reflect.get(win, 'storageEvents') as number
        })), setting);
        const settled = await snapshot();
        console.log('Fallback storage deliveries:', settled.map(row => row.events));
        assert(settled.every(row => row.durable === '30' && row.session === '30'), 'Fallback frames must keep the latest setting');
        assert(settled.every(row => row.events <= 30), `Settings updates amplified into ${JSON.stringify(settled.map(row => row.events))} events`);
        await page.waitForTimeout(200);
        assert.deepEqual(await snapshot(), settled, 'Storage events must stop after the updates settle');
        await page.evaluate(() => {
            const frame = document.querySelector<HTMLIFrameElement>('#first')!.contentWindow!;
            (Reflect.get(frame, 'fixtureSettings') as typeof SettingsStore).clear('Superheater', 'natures');
        });
        await page.waitForFunction(key => [window, ...Array.from(document.querySelectorAll('iframe')).map(frame => frame.contentWindow!)].every(win => win.localStorage.getItem(key) === null && win.sessionStorage.getItem(key) === null), setting);
        console.log('PASS: fallback frames converge after rapid settings updates, stop emitting events and receive removals');
    } finally {
        await page.close();
    }
}

try {
    const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, B0T_PROFILE_DIR: profile, B0T_RUNTIME_DIR: profile })
        .filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: require('../desktop/node_modules/electron'), args: [join(root, 'desktop'), `--server=${url}`], env });
    app.process().stderr?.on('data', chunk => { stderr += chunk.toString(); });
    let page: Page | undefined;
    for (let tries = 0; tries < 100; tries++) {
        page = app.windows().find(candidate => candidate.url() === url);
        if (page) break;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert(page, 'Fixture window did not load');
    await page.waitForFunction(() => !!window.rs2b0tDesktopStorage);
    await page.evaluate(async () => {
        await Promise.all(['first', 'second'].map(id => new Promise<void>(resolve => {
            const frame = document.createElement('iframe');
            frame.id = id;
            frame.src = `/frame.html?id=${id}`;
            frame.onload = () => resolve();
            document.body.append(frame);
        })));
    });
    await synced(page, null);
    const plainHasBridge = await app.evaluate(async ({ BrowserWindow }, url) => {
        const plain = new BrowserWindow({ show: false });
        await plain.loadURL(url);
        return plain.webContents.executeJavaScript(`new Promise(resolve => {
            const frame = document.createElement('iframe');
            frame.src = '/plain-frame.html';
            frame.onload = () => resolve(!!frame.contentWindow.rs2b0tDesktopStorage);
            document.body.append(frame);
        })`);
    }, url);
    assert.equal(plainHasBridge, false);
    await page.evaluate(key => window.rs2b0tDesktopStorage!.setItem(key, 'initial'), key);
    await synced(page, 'initial');
    await page.evaluate(key => document.querySelector<HTMLIFrameElement>('#first')!.contentWindow!.rs2b0tDesktopStorage!.setItem(key, 'from-child'), key);
    await synced(page, 'from-child');
    await page.evaluate(async key => {
        for (let index = 0; index < 40; index++) {
            const frame = document.createElement('iframe');
            frame.src = `/temporary.html?index=${index}`;
            document.body.append(frame);
            window.rs2b0tDesktopStorage!.setItem(key, `loading-${index}`);
            await new Promise(resolve => setTimeout(resolve, 10));
            frame.remove();
            window.rs2b0tDesktopStorage!.setItem(key, `removed-${index}`);
        }
    }, key);
    await synced(page, 'removed-39');
    await page.evaluate(async key => {
        const frame = document.querySelector<HTMLIFrameElement>('#first')!;
        const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
        frame.src = '/frame.html?reloaded';
        window.rs2b0tDesktopStorage!.setItem(key, 'during-navigation');
        await loaded;
    }, key);
    await synced(page, 'during-navigation');
    const { sharedStorage } = require('../desktop/shared-storage.cjs');
    sharedStorage(join(profile, 'Shared Storage')).setItem(key, 'external-instance');
    await synced(page, 'external-instance');
    await page.evaluate(key => window.rs2b0tDesktopStorage!.removeItem(key), key);
    await synced(page, null);
    await verifyFallbackStorage(app);
    await app.close();
    app = undefined;
    const errors = stderr.split('\n').filter(line => /ipcNative|Uncaught Exception|Unable to load preload/i.test(line));
    assert.deepEqual(errors, [], 'Storage updates must not target frames without an IPC bridge');
    console.log('PASS: main/subframe settings sync, 40 frame replacements, reload catch-up, external writes and removal; zero ipcNative errors');
} finally {
    if (app) await app.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true });
}
