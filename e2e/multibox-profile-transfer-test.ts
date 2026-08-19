// Wall settings export/import: [self-serve]. Builds the wall, serves it, creates a vault through the UI, exports a file, imports a replacement file, and checks the vault.

//   bun e2e/multibox-profile-transfer-test.ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { fail, launchBrowser } from './lib/harness.js';
import { serializeProfileFile } from '../src/bot/multibox/ProfileTransfer.js';

const PORT = 8791;
const PASSPHRASE = 'transfer-e2e';

type Mbx = { multibox: { profiles(): string[] } };

const build = Bun.spawnSync(['bun', 'run', 'build:bot:dev'], { stdout: 'pipe', stderr: 'pipe' });
if (build.exitCode !== 0) {
    fail(`build:bot:dev failed\n${build.stderr.toString()}\n${build.stdout.toString()}`);
}

const server = Bun.serve({
    port: PORT,
    async fetch(req) {
        const path = new URL(req.url).pathname;
        if (path === '/multibox.html' || path === '/') {
            return new Response(Bun.file('public-bot/multibox.html'), { headers: { 'cache-control': 'no-store' } });
        }
        if (path === '/bot.html') {
            return new Response(Bun.file('public-bot/bot.html'), { headers: { 'cache-control': 'no-store' } });
        }
        if (path.startsWith('/bot/')) {
            const file = join('out', path.slice('/bot/'.length));
            return new Response(Bun.file(file), { headers: { 'cache-control': 'no-store' } });
        }
        return new Response('not found', { status: 404 });
    }
});

const browser = await launchBrowser();
try {
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`http://127.0.0.1:${PORT}/multibox.html`);
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30_000 });
    console.log('wall booted');

    await page.click('#mbx-settings');
    await page.waitForSelector('#mbx-settings-overlay:not([hidden])');
    console.log('settings opened');

    await page.click('#mbx-export-profile');
    await page.waitForSelector('#mbx-vault-pass');
    await page.fill('#mbx-vault-pass', PASSPHRASE);
    await page.fill('#mbx-vault-confirm', PASSPHRASE);
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15_000 }),
        page.click('#mbx-vault-go')
    ]);
    const exported = await download.path();
    if (!exported) {
        fail('export did not produce a file');
    }
    const exportedText = await Bun.file(exported).text();
    if (!exportedText.includes('"kind": "rs2b0t-multibox-profiles"')) {
        fail(`export file missing kind: ${exportedText}`);
    }
    console.log(`exported ${download.suggestedFilename()}`);

    const incoming = serializeProfileFile({
        profiles: [
            { username: 'import_alice', password: 'a', tab: 'miners' },
            { username: 'import_bob', password: 'b' }
        ],
        tabs: ['miners'],
        activeTab: 'miners',
        storage: {
            import_alice: {
                selectedScript: 'Miner',
                'set:Miner:rock': 'iron',
                'set:Global:runAuto': 'false'
            },
            import_bob: {
                selectedScript: 'BrimhavenAgility',
                'set:BrimhavenAgility:food': 'Lobster'
            }
        }
    });
    const incomingPath = join(mkdtempSync(join(tmpdir(), 'mbx-profile-')), 'rs2b0t-profiles.json');
    writeFileSync(incomingPath, incoming);
    await page.setInputFiles('#mbx-import-file', incomingPath);
    await page.waitForFunction(() => (globalThis as never as Mbx).multibox.profiles().includes('import_alice'), undefined, { timeout: 10_000 });
    const names = await page.evaluate(() => (globalThis as never as Mbx).multibox.profiles());
    if (JSON.stringify(names) !== JSON.stringify(['import_alice', 'import_bob'])) {
        fail(`vault after import: ${JSON.stringify(names)}`);
    }
    const hidden = await page.evaluate(() => (document.getElementById('mbx-settings-overlay') as HTMLElement).hidden);
    if (!hidden) {
        fail('settings stayed open after a successful import');
    }
    const stored = await page.evaluate(() => ({
        script: localStorage.getItem('rs2b0t:import_alice:selectedScript'),
        rock: localStorage.getItem('rs2b0t:import_alice:set:Miner:rock'),
        run: localStorage.getItem('rs2b0t:import_alice:set:Global:runAuto'),
        food: localStorage.getItem('rs2b0t:import_bob:set:BrimhavenAgility:food'),
        sessionScript: sessionStorage.getItem('rs2b0t:import_alice:selectedScript'),
        settingsAfterOn: document.getElementById('mbx-renderers-on')!.compareDocumentPosition(document.getElementById('mbx-settings')!) & Node.DOCUMENT_POSITION_FOLLOWING
    }));
    if (stored.script !== 'Miner' || stored.rock !== 'iron' || stored.run !== 'false' || stored.food !== 'Lobster') {
        fail(`imported box storage: ${JSON.stringify(stored)}`);
    }
    if (stored.sessionScript !== 'Miner') {
        fail(`sessionStorage did not receive selectedScript: ${JSON.stringify(stored)}`);
    }
    if (!stored.settingsAfterOn) {
        fail('settings button is not after turn-all-renderers-on');
    }
    console.log(`imported ${names.join(', ')} with script settings`);
    console.log('PASS: settings export/import');
} finally {
    await browser.close();
    server.stop(true);
}
