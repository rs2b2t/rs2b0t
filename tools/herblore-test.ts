// Validates the ProcessingBot self-op path via the Herbalist preset:
// Identify unidentified herbs in the inventory (op on the item itself).
import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';
const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 2 });
const username = `herb${Date.now().toString(36).slice(-7)}`;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const clean = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('guam leaf')).length);
    const herbs = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => (i.name ?? '') === 'Herb').length);
    await page.goto(`${base}/bot.html`); await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: 1400 });
    for (let i = 0; i < 8; i++) await type(page, '::give unidentified_guam', 1400);
    await type(page, '::advancestat herblore 10', 1400);
    console.log(`unidentified herbs: ${await herbs()}`);
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Herblore/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'Herbalist' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log('Herbalist started...');
    const deadline = Date.now() + minutes * 60_000; let done = 0, lastLogged = 0;
    while (Date.now() < deadline && done === 0) {
        await page.waitForTimeout(5000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const chat = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.chat(2).map(c => c.text).join(' | '));
        console.log(`  [diag] herbs ${await herbs()} clean ${await clean()} | chat: ${chat}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('Herbalist crashed');
        done = await clean();
    }
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (done === 0) fail('no identified herbs — self-op did not work');
    console.log('\nresult: Herbalist identified herbs — PASS');
} finally { await browser.close(); }
