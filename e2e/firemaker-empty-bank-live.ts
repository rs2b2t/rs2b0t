import { strict as assert } from 'node:assert';
import { cheatQuiet, deployIsolatedClient, launchBrowser, setSettings } from './lib/harness.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

interface Api {
    rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
}

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `fm${Date.now().toString(36).slice(-7)}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user, client.page);
    assert(await cheatQuiet(page, '~clearinv'));
    assert(await cheatQuiet(page, 'give tinderbox 1'));
    assert(await teleTo(page, { x: 3253, z: 3420, level: 0 }, 2, 30_000));
    await setSettings(page, 'Firemaker', { logType: 'Logs', location: 'Varrock East' });
    await startScript(page, 'Firemaker');
    await page.waitForFunction(() => (globalThis as never as Api).rs2b0t.runner.ctx?.log.some(row => row.msg.includes('no Logs left in the bank')), undefined, { timeout: 45_000 });
    const result = await page.evaluate(() => ({ state: (globalThis as never as Api).rs2b0t.runner.state, logs: (globalThis as never as Api).rs2b0t.runner.ctx?.log.map(row => row.msg) }));
    assert.notEqual(result.state, 'running');
    await page.screenshot({ path: 'docs/e2e/firemaker-empty-bank-live.png' });
    console.log(JSON.stringify(result, null, 2));
} finally {
    await browser.close();
    client.cleanup();
}
