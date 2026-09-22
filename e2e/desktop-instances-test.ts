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
        checks: [
            'separate ports and build directories',
            'shared bundle unchanged',
            'legacy accounts and settings migrate automatically',
            'one shared account/settings store',
            'concurrent account additions survive in both windows',
            'bot iframe reads shared settings without exposing Node',
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
