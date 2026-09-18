import { strict as assert } from 'node:assert';
import { cheatQuiet, deployIsolatedClient, launchBrowser, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, relog, startScript, teleTo } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Skills: { xp(name: string): number }; Inventory: { count(name: string): number }; Bank: { openNearest(name: string, op: string): Promise<boolean>; depositInventory(): Promise<void>; count(name: string): number; close(): Promise<boolean> } };
    rs2b0t: { runner: { state: string; stop(reason: string): void; ctx: { log: { msg: string }[] } | null } };
}

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `zc${Date.now().toString(36).slice(-7)}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user, client.page);
    assert(await cheatQuiet(page, '~clearinv'));
    assert(await cheatQuiet(page, 'setvar zanaris 6'));
    assert(await cheatQuiet(page, 'setstat cooking 99'));
    await clearChatDialogs(page, 'cooking level');
    assert(await cheatQuiet(page, 'give raw_shrimp 1'));
    assert(await teleTo(page, { x: 3253, z: 3420, level: 0 }, 2, 30_000));
    assert(await page.evaluate(async () => {
        const bank = (globalThis as never as Api).__rs2b0t.Bank;
        if (!(await bank.openNearest('Bank booth', 'Use-quickly'))) return false;
        await bank.depositInventory();
        return true;
    }));
    await page.waitForFunction(() => (globalThis as never as Api).__rs2b0t.Bank.count('Raw shrimps') === 1, undefined, { timeout: 10_000 });
    assert(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Bank.close()));
    await relog(page, user);
    assert(await teleTo(page, { x: 3153, z: 9576, level: 0 }, 2, 30_000));
    await setSettings(page, 'Global', { useZanarisBank: true });
    await setSettings(page, 'CookBot', { location: 'Zanaris', fish: 'Raw shrimps', surface: 'Range' });
    const before = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('cooking'));
    await startScript(page, 'CookBot');
    await page.waitForFunction(xp => (globalThis as never as Api).__rs2b0t.Skills.xp('cooking') > xp, before, { timeout: 90_000 });
    const result = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return { xp: g.__rs2b0t.Skills.xp('cooking'), shrimps: g.__rs2b0t.Inventory.count('Shrimps'), logs: g.rs2b0t.runner.ctx?.log.map(row => row.msg) };
    });
    assert(result.xp > before);
    assert(result.shrimps > 0);
    await page.screenshot({ path: 'docs/e2e/cookbot-zanaris-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness complete'));
    console.log(JSON.stringify({ ...result, xpGained: result.xp - before }, null, 2));
} finally {
    await browser.close();
    client.cleanup();
}
