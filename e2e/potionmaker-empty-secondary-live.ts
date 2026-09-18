import { strict as assert } from 'node:assert';
import { cheatQuiet, deployIsolatedClient, launchBrowser, setSettings } from './lib/harness.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Inventory: { countById(id: number): number }; Bank: { isOpen(): boolean } };
    rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
}

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `pm${Date.now().toString(36).slice(-7)}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user, client.page);
    assert(await cheatQuiet(page, '~clearinv'));
    assert(await cheatQuiet(page, 'give guamvial 14'));
    assert(await teleTo(page, { x: 3253, z: 3420, level: 0 }, 2, 30_000));
    await page.waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.countById(91) === 14, undefined, { timeout: 10_000 });
    await setSettings(page, 'PotionMaker', { herb: 'Guam leaf', secondary: 'Eye of newt' });
    await startScript(page, 'PotionMaker');
    await page.waitForFunction(() => (globalThis as never as Api).rs2b0t.runner.ctx?.log.some(row => row.msg.includes('no Eye of newt in the bank')), undefined, { timeout: 45_000 });
    await page.waitForFunction(() => (globalThis as never as Api).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10_000 });
    const result = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return { state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.map(row => row.msg), unfinished: g.__rs2b0t.Inventory.countById(91), bankOpen: g.__rs2b0t.Bank.isOpen() };
    });
    assert.notEqual(result.state, 'running');
    assert.equal(result.unfinished, 14);
    assert.equal(result.bankOpen, false);
    await page.screenshot({ path: 'docs/e2e/potionmaker-empty-secondary-live.png' });
    console.log(JSON.stringify(result, null, 2));
} finally {
    await browser.close();
    client.cleanup();
}
