import type { Page } from 'playwright-core';
import type { Account, SlotSnapshot } from '../src/bot/multibox/types.js';
import type { WorldNumber } from '../src/client/config/worlds.js';
import type { SettingsStore } from '../src/bot/runtime/Settings.js';

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, type ElectronApplication } from 'playwright-core';

if (process.versions.bun) {
    const child = Bun.spawn(['node', import.meta.path], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    process.exit(await child.exited);
}

const root = resolve(import.meta.dirname, '..');
const profiles = mkdtempSync(join(tmpdir(), 'rs2b0t-desktop-e2e-'));
const proofDir = join(root, 'out/e2e/desktop-instances');
const require = createRequire(import.meta.url);
const executablePath: string = require('../desktop/node_modules/electron');
const apps: ElectronApplication[] = [];
const launchers: ReturnType<typeof spawn>[] = [];
const logs: string[] = [];
const builds = new Map<number, string>();
const snapshotHash = () =>
    existsSync(join(root, 'out/botclient.js'))
        ? createHash('sha256')
            .update(readFileSync(join(root, 'out/botclient.js')))
            .digest('hex')
        : null;
const originalHash = snapshotHash();

async function launchProxy() {
    const env: NodeJS.ProcessEnv = { ...process.env, B0T_VIEWER: 'none' };
    delete env.PORT;
    delete env.B0T_NO_OPEN;
    delete env.B0T_RESOURCE_PID;
    const child = spawn('sh', ['tools/b0t.sh'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise<number | null>(resolve => child.on('exit', resolve));
    const index = launchers.push(child) - 1;
    logs[index] = '';
    const ready = Promise.withResolvers<{ port: number; build: string; child: typeof child; exited: typeof exited }>();
    const timeout = setTimeout(() => ready.reject(new Error(`Launcher timed out: ${logs[index]}`)), 60000);
    const capture = (chunk: Buffer) => {
        logs[index] += chunk.toString();
        const port = /live-proxy: http:\/\/localhost:(\d+)\//.exec(logs[index]);
        const build = /instance build: (.+)/.exec(logs[index]);
        if (port && build) {
            builds.set(Number(port[1]), build[1].trim());
            ready.resolve({ port: Number(port[1]), build: build[1].trim(), child, exited });
        }
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', ready.reject);
    void exited.then(code => ready.reject(new Error(`Launcher exited (${code}): ${logs[index]}`)));
    try {
        return await ready.promise;
    } finally {
        clearTimeout(timeout);
    }
}

async function launchDesktop(port: number, profile: string) {
    const env: Record<string, string> = Object.fromEntries(Object.entries({ ...process.env, B0T_PROFILE_DIR: profile, B0T_RUNTIME_DIR: join(builds.get(port)!, 'electron') }).filter((entry): entry is [string, string] => entry[1] !== undefined));
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({ executablePath, args: [join(root, 'desktop'), `--server=http://localhost:${port}/multibox.html`], env });
    apps.push(app);
    const paths = await app.evaluate(({ app }) => ({ userData: app.getPath('userData'), sessionData: app.getPath('sessionData') }));
    assert.notEqual(paths.userData, profile);
    assert.equal(paths.userData, paths.sessionData);
    const deadline = Date.now() + 15000;
    let page = app.windows().find(page => page.url().endsWith('/multibox.html') && !page.isClosed());
    while (!page && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
        page = app.windows().find(page => page.url().endsWith('/multibox.html') && !page.isClosed());
    }
    assert.ok(page, 'Electron did not open the multibox window');
    await page.waitForFunction(() => document.getElementById('mbx-build')?.textContent !== '…');
    return { app, page, paths, pid: app.process().pid };
}

async function seedLegacyProfile(profile: string) {
    mkdirSync(profile, { recursive: true });
    const seedMain = join(profiles, 'seed.cjs');
    writeFileSync(
        seedMain,
        `const { app, BrowserWindow, protocol } = require('electron');
app.setPath('userData', process.env.B0T_PROFILE_DIR);
app.setPath('sessionData', process.env.B0T_PROFILE_DIR);
app.whenReady().then(() => {
    protocol.handle('http', () => new Response('<!doctype html><title>Legacy storage fixture</title>'));
    new BrowserWindow().loadURL('http://localhost:8081/multibox.html');
});
app.on('window-all-closed', () => app.quit());`
    );
    const app = await _electron.launch({ executablePath, args: [seedMain], env: { B0T_PROFILE_DIR: profile } });
    apps.push(app);
    const page = await app.firstWindow();
    await page.waitForLoadState();
    await page.evaluate(() => {
        localStorage.setItem('rs2b0t:legacy-proof', 'migrated');
        localStorage.setItem('rs2b0t:multibox:accounts', JSON.stringify([{ username: 'legacy-fixture', password: 'fixture-only' }]));
    });
    await app.evaluate(({ session }) => session.defaultSession.flushStorageData());
    await app.close();
}

async function unlock(page: import('playwright-core').Page, setup = false) {
    await page.locator('#mbx-add').click();
    await page.locator('#mbx-vault-pass').fill('fixture-passphrase');
    if (setup) await page.locator('#mbx-vault-confirm').fill('fixture-passphrase');
    await page.locator('#mbx-vault-go').click();
    await page.locator('.mbx-chooser-overlay:not([hidden]) .mbx-chooser-list').waitFor();
    await page.keyboard.press('Escape');
}

type WallWindow = Window & {
    multibox: {
        add(account: Account): SlotSnapshot;
        setWorld(id: number, world: WorldNumber): Promise<boolean>;
        controller: { remove(id: number): void };
    };
};

type BotWindow = Window & { __rs2b0t?: { SettingsStore: typeof SettingsStore }; rs2b0t?: unknown };

async function verifyDesktopWorldSettings(page: Page): Promise<void> {
    const id = await page.evaluate(() => {
        localStorage.setItem('rs2b0t:switch-proof:selectedScript', 'Fisher');
        return (Reflect.get(window, 'multibox') as WallWindow['multibox']).add({ username: 'switch-proof', password: '', world: 1 }).id;
    });
    const selector = 'iframe[title="switch-proof"]';
    const ready = () => page.waitForFunction(selector => {
        const win = document.querySelector<HTMLIFrameElement>(selector)?.contentWindow as BotWindow | null;
        return !!win?.rs2b0t && !!win.__rs2b0t;
    }, selector);
    try {
        await ready();
        await page.locator(selector).evaluate(element => {
            const win = (element as HTMLIFrameElement).contentWindow as BotWindow;
            win.__rs2b0t!.SettingsStore.save('MarketMaker', 'blacklist', 'trade_troll');
            win.__rs2b0t!.SettingsStore.save('Miner', 'ore', 'Coal');

        });
        const controls = page.frameLocator(selector);
        await controls.getByRole('button', { name: '✎ Edit parameters' }).click();
        const method = controls.locator('.rs2b0t-param-row').filter({ hasText: 'Fishing method' }).locator('select');
        const [fishMethod] = await method.selectOption({ index: 1 });
        await method.press('Escape');
        for (const world of [2, 1] as const) {
            const results = await page.evaluate(({ id, world }) => Promise.all(Array.from({ length: 10 }, () => (Reflect.get(window, 'multibox') as WallWindow['multibox']).setWorld(id, world))), { id, world });
            assert.equal(results.filter(Boolean).length, 1);
            await ready();
            const saved = await page.locator(selector).evaluate(element => {
                const win = (element as HTMLIFrameElement).contentWindow as BotWindow;
                return {
                    origin: win.location.origin,
                    box: new URLSearchParams(win.location.search).get('box'),
                    world: new URLSearchParams(win.location.search).get('world'),
                    blacklist: win.__rs2b0t!.SettingsStore.saved('MarketMaker', 'blacklist'),
                    ore: win.__rs2b0t!.SettingsStore.saved('Miner', 'ore'),
                    selected: win.localStorage.getItem('rs2b0t:switch-proof:selectedScript'),
                    fishMethod: win.__rs2b0t!.SettingsStore.saved('Fisher', 'fishMethod'),
                    displayed: win.document.querySelector('.rs2b0t-current-script')?.textContent
                };
            });
            assert.deepEqual(saved, { origin: new URL(page.url()).origin, box: 'switch-proof', world: String(world), blacklist: 'trade_troll', ore: 'Coal', selected: 'Fisher', fishMethod, displayed: 'Fisher' });
        }
        console.log('Electron world switches preserve account, script selection and script settings in both directions');
    } finally {
        await page.evaluate(id => (Reflect.get(window, 'multibox') as WallWindow['multibox']).controller.remove(id), id);
    }
}

async function stopProxy(proxy: Awaited<ReturnType<typeof launchProxy>>) {
    proxy.child.kill('SIGTERM');
    await proxy.exited;
    assert.equal(existsSync(proxy.build), false, 'stopped instance left its build behind');
}

try {
    mkdirSync(proofDir, { recursive: true });
    const first = await launchProxy();
    const build = await (await fetch(`http://127.0.0.1:${first.port}/bot/version.json`)).json();
    const firstBundle = await (await fetch(`http://127.0.0.1:${first.port}/bot/botclient.js`)).text();
    const second = await launchProxy();
    assert.notEqual(first.port, second.port);
    assert.notEqual(first.build, second.build);
    assert.equal(snapshotHash(), originalHash, 'launch overwrote shared out/botclient.js');
    await seedLegacyProfile(join(profiles, 'shared'));
    const firstDesktop = await launchDesktop(first.port, join(profiles, 'shared'));
    assert.equal(await firstDesktop.page.evaluate(() => localStorage.getItem('rs2b0t:legacy-proof')), 'migrated');
    await unlock(firstDesktop.page, true);
    await firstDesktop.page.evaluate(() => localStorage.setItem('rs2b0t:instance-proof', 'first'));
    const secondDesktop = await launchDesktop(second.port, join(profiles, 'shared'));
    await unlock(secondDesktop.page);
    const importAccount = (page: import('playwright-core').Page, username: string) =>
        page.evaluate(async username => {
            const wall = (window as unknown as { multibox: { importProfiles(profiles: { username: string; password: string }[]): Promise<number> } }).multibox;
            return wall.importProfiles([{ username, password: 'fixture-only' }]);
        }, username);
    await Promise.all([importAccount(firstDesktop.page, 'first-fixture'), importAccount(secondDesktop.page, 'second-fixture')]);
    for (const page of [firstDesktop.page, secondDesktop.page]) {
        await page.waitForFunction(() => {
            const names = (window as unknown as { multibox: { profiles(): string[] } }).multibox.profiles();
            return ['legacy-fixture', 'first-fixture', 'second-fixture'].every(name => names.includes(name));
        });
    }
    await verifyDesktopWorldSettings(firstDesktop.page);
    await firstDesktop.page.evaluate(() => {
        const frame = document.createElement('iframe');
        frame.id = 'storage-proof-frame';
        frame.src = '/bot.html';
        document.body.appendChild(frame);
    });
    const frame = firstDesktop.page.frameLocator('#storage-proof-frame');
    await frame.locator('body').waitFor();
    await firstDesktop.page.waitForFunction(() => {
        const frame = document.querySelector<HTMLIFrameElement>('#storage-proof-frame');
        return !!frame?.contentWindow?.rs2b0tDesktopStorage;
    });
    await secondDesktop.page.evaluate(() => localStorage.setItem('rs2b0t:shared:set:Miner:ore', 'Iron'));
    await firstDesktop.page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('#storage-proof-frame')?.contentWindow?.localStorage.getItem('rs2b0t:shared:set:Miner:ore') === 'Iron');
    assert.equal(await firstDesktop.page.locator('#storage-proof-frame').evaluate(element => typeof ((element as HTMLIFrameElement).contentWindow as unknown as { require?: unknown }).require), 'undefined');
    await firstDesktop.page.waitForFunction(() => !!(document.querySelector<HTMLIFrameElement>('#storage-proof-frame')?.contentWindow as Window & { __rs2b0t?: unknown }).__rs2b0t);
    await firstDesktop.app.evaluate(({ ipcMain }) => {
        const counts: Record<string, number> = {};
        Object.assign(globalThis, { storageCalls: counts });
        ipcMain.on('rs2b0t-storage', (_: unknown, method: string) => { counts[method] = (counts[method] ?? 0) + 1; });
    });
    const performanceProof = await firstDesktop.page.locator('#storage-proof-frame').evaluate(async element => {
        const win = (element as HTMLIFrameElement).contentWindow as Window & { __rs2b0t: { SettingsStore: typeof import('../src/bot/runtime/Settings.js').SettingsStore } };
        const durations: number[] = [];
        const started = performance.now();
        for (let frame = 0; frame < 60; frame++) {
            await new Promise(resolve => requestAnimationFrame(resolve));
            const start = performance.now();
            for (let read = 0; read < 5; read++) win.__rs2b0t.SettingsStore.globalBag();
            durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b);
        return { frames: durations.length, bagsPerFrame: 5, settingsPerBag: Object.keys(win.__rs2b0t.SettingsStore.globalBag().raw()).length, medianWorkMs: durations[30], p95WorkMs: durations[57], elapsedMs: performance.now() - started };
    });
    const storageCalls = await firstDesktop.app.evaluate(() => (globalThis as unknown as { storageCalls: Record<string, number> }).storageCalls);
    const performanceResult = { build, verifiedAt: new Date().toISOString(), ...performanceProof, storageCalls };
    writeFileSync(join(proofDir, 'settings-performance.json'), JSON.stringify(performanceResult, null, 2) + '\n');
    console.log(JSON.stringify(performanceResult, null, 2));
    assert.equal(storageCalls.getItem ?? 0, 0, 'path overlay settings reads block the renderer on synchronous IPC');
    await secondDesktop.page.evaluate(() => localStorage.setItem('rs2b0t:set:Global:navPathColorPath', '#000000'));
    await firstDesktop.page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('#storage-proof-frame')?.contentWindow?.localStorage.getItem('rs2b0t:set:Global:navPathColorPath') === '#000000');
    await firstDesktop.app.evaluate(({ ipcMain }) => {
        const holdFileNotifications = (_: unknown, method: string, key: string) => {
            if (method !== 'setItem' || key !== 'rs2b0t:set:Global:navPathColorPath') return;
            ipcMain.removeListener('rs2b0t-storage', holdFileNotifications);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
        };
        ipcMain.on('rs2b0t-storage', holdFileNotifications);
    });
    const store = require('../desktop/shared-storage.cjs').sharedStorage(join(profiles, 'shared', 'Shared Storage'));
    const writeStarted = Date.now();
    const localWrite = firstDesktop.page.locator('#storage-proof-frame').evaluate(element => {
        const win = (element as HTMLIFrameElement).contentWindow!;
        win.localStorage.setItem('rs2b0t:set:Global:navPathColorPath', '#111111');
        return win.localStorage.getItem('rs2b0t:set:Global:navPathColorPath');
    });
    while (store.getItem('rs2b0t:set:Global:navPathColorPath') !== '#111111' && Date.now() - writeStarted < 900) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(store.getItem('rs2b0t:set:Global:navPathColorPath'), '#111111');
    store.setItem('rs2b0t:set:Global:navPathColorPath', '#000000');
    assert.ok(Date.now() - writeStarted < 900, 'external write must finish before the main event loop resumes');
    assert.equal(await localWrite, '#111111', 'synchronous setting writes must update the local cache');
    await firstDesktop.page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('#storage-proof-frame')?.contentWindow?.localStorage.getItem('rs2b0t:set:Global:navPathColorPath') === '#000000');
    await secondDesktop.page.evaluate(() => localStorage.removeItem('rs2b0t:set:Global:navPathColorPath'));
    await firstDesktop.page.waitForFunction(() => document.querySelector<HTMLIFrameElement>('#storage-proof-frame')?.contentWindow?.localStorage.getItem('rs2b0t:set:Global:navPathColorPath') === null);
    assert.equal(await secondDesktop.page.evaluate(() => localStorage.getItem('rs2b0t:instance-proof')), 'first', 'saved settings were not shared across ports');
    await secondDesktop.page.evaluate(() => localStorage.setItem('rs2b0t:instance-proof', 'second'));
    await secondDesktop.page.goto(`http://localhost:${second.port}/multibox.html`);
    await firstDesktop.page.locator('#storage-proof-frame').evaluate(element => element.remove());
    await firstDesktop.page.locator('#mbx-add').click();
    await secondDesktop.page.locator('#mbx-add').click();
    await firstDesktop.page.screenshot({ path: join(proofDir, 'first.png') });
    await secondDesktop.page.screenshot({ path: join(proofDir, 'second.png') });
    await secondDesktop.app.close();
    await stopProxy(second);
    assert.equal(await (await fetch(`http://127.0.0.1:${first.port}/bot/botclient.js`)).text(), firstBundle);
    await firstDesktop.page.reload();
    assert.equal(await firstDesktop.page.evaluate(() => localStorage.getItem('rs2b0t:instance-proof')), 'second');
    const reopened = await launchDesktop(first.port, join(profiles, 'shared'));
    assert.equal(await reopened.page.evaluate(() => localStorage.getItem('rs2b0t:instance-proof')), 'second', 'profile did not persist across restarts');
    await reopened.app.close();
    await firstDesktop.app.close();
    await stopProxy(first);
    assert.equal(existsSync(firstDesktop.paths.userData), false);
    assert.equal(existsSync(secondDesktop.paths.userData), false);
    const proof = {
        passed: true,
        build,
        verifiedAt: new Date().toISOString(),
        ports: [first.port, second.port],
        builds: [first.build, second.build],
        electronPids: [firstDesktop.pid, secondDesktop.pid],
        sharedSavedData: join(profiles, 'shared', 'Shared Storage', 'storage.json'),
        browserCaches: [firstDesktop.paths, secondDesktop.paths],
        settingsPerformance: performanceResult,
        checks: [
            'separate ports and build directories',
            'shared bundle unchanged',
            'legacy accounts and settings migrate automatically',
            'one shared account/settings store',
            'concurrent account additions survive in both windows',
            'bot iframe reads shared settings without exposing Node',
            'world switches preserve account, script selection and script settings in both directions',
            'path overlay settings workload performs zero synchronous IPC reads',
            'settings cache observes a reverted write even when file notifications coalesce',
            'setting removal propagates between instances',
            'settings shared across ports',
            'saved settings persist after restart',
            'closing second instance leaves first serving its original bundle',
            'reload reads the shared saved settings',
            'private builds and browser caches removed on shutdown'
        ]
    };
    writeFileSync(join(proofDir, 'proof.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof, null, 2));
} finally {
    for (const app of apps.reverse()) await app.close().catch(() => {});
    for (const child of launchers) {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = new Promise(resolve => child.on('exit', resolve));
            child.kill('SIGTERM');
            await exited;
        }
    }
    for (const [index, log] of logs.entries()) writeFileSync(join(proofDir, `launcher-${index + 1}.log`), log);
    rmSync(profiles, { recursive: true, force: true });
}
