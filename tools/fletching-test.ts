// Validates the ProcessingBot make-X dialog path via the Fletcher preset:
// knife + logs -> "What would you like to make?" -> Arrow shafts. Exercises
// useItemOnItem and the MakeDialog task (chatOptions + ifButton/pausebutton).
//
// Usage: bun tools/fletching-test.ts [minutes] [base-url]

import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 2 });
const username = `flet${Date.now().toString(36).slice(-7)}`;

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const shafts = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('arrow shaft')).length);
    const logCount = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => (i.name ?? '').toLowerCase() === 'logs').length);

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: 1400 });
    await type(page, '::give knife', 1400);
    for (let i = 0; i < 12; i++) await type(page, '::give logs', 1400);
    await type(page, '::advancestat fletching 10', 1400);

    console.log(`knife + ${await logCount()} logs`);
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Fletching/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'Fletcher' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.rs2b0t-current-script');
    if (current !== 'Fletcher') fail(`expected Fletcher selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Fletcher started, running up to ${minutes}min...`);
    const deadline = Date.now() + minutes * 60_000;
    let made = 0, lastLogged = 0;
    while (Date.now() < deadline && made === 0) {
        await page.waitForTimeout(6000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const extra = await page.evaluate(() => { const r = (globalThis as never as Rs2b0t).rs2b0t.reader as unknown as { chat(n: number): { text: string }[]; modals(): { chat: number }; makeProducts(): { name: string }[] }; return { chat: r.chat(3).map(c => c.text).join(' | '), chatModal: r.modals().chat, products: r.makeProducts().map(p => p.name) }; });
        console.log(`  [diag] logs ${await logCount()} shafts ${await shafts()} chatModal ${extra.chatModal} products [${extra.products.join(',')}] | chat: ${extra.chat}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('Fletcher crashed');
        made = await shafts();
    }
    await page.screenshot({ path: 'out/fletching-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (made === 0) fail('no arrow shafts — fletching make-dialog did not work');
    console.log('\nresult: Fletcher made arrow shafts via the make-X dialog — PASS');
} finally {
    await browser.close();
}
