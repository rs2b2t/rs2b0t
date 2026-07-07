// Validates the ProcessingBot make-X dialog path via the Fletcher preset:
// knife + logs -> "What would you like to make?" -> Arrow shafts. Exercises
// useItemOnItem and the MakeDialog task (chatOptions + ifButton/pausebutton).
//
// Usage: bun tools/fletching-test.ts [minutes] [base-url]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '2');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `flet${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { inventory(): { name: string | null }[]; worldTile(): { x: number; z: number } | null; chat(n: number): { text: string }[] };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(400); await page.keyboard.type(t, { delay: 25 }); await page.keyboard.press('Enter'); await page.waitForTimeout(1400); };
    const shafts = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('arrow shaft')).length);
    const logCount = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '').toLowerCase() === 'logs').length);

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    await type('::give knife');
    for (let i = 0; i < 12; i++) await type('::give logs');
    await type('::advancestat fletching 10');

    console.log(`knife + ${await logCount()} logs`);
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Fletching/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'Fletcher' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.lcb-current-script');
    if (current !== 'Fletcher') fail(`expected Fletcher selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Fletcher started, running up to ${minutes}min...`);
    const deadline = Date.now() + minutes * 60_000;
    let made = 0, lastLogged = 0;
    while (Date.now() < deadline && made === 0) {
        await page.waitForTimeout(6000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const extra = await page.evaluate(() => { const r = (globalThis as never as Lcb).lcbuddy.reader as unknown as { chat(n: number): { text: string }[]; modals(): { chat: number }; makeProducts(): { name: string }[] }; return { chat: r.chat(3).map(c => c.text).join(' | '), chatModal: r.modals().chat, products: r.makeProducts().map(p => p.name) }; });
        console.log(`  [diag] logs ${await logCount()} shafts ${await shafts()} chatModal ${extra.chatModal} products [${extra.products.join(',')}] | chat: ${extra.chat}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('Fletcher crashed');
        made = await shafts();
    }
    await page.screenshot({ path: 'out/fletching-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (made === 0) fail('no arrow shafts — fletching make-dialog did not work');
    console.log('\nresult: Fletcher made arrow shafts via the make-X dialog — PASS');
} finally {
    await browser.close();
}
