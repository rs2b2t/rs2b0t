// Validates the ProcessingBot self-op path via the Herbalist preset:
// Identify unidentified herbs in the inventory (op on the item itself).
import { chromium } from 'playwright-core';
const minutes = parseFloat(process.argv[2] ?? '2');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `herb${Date.now().toString(36).slice(-7)}`;
function fail(m: string): never { console.error(`FAIL: ${m}`); process.exit(1); }
type Lcb = { lcbuddy: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> }; runner: { state: string; ctx: { log: { msg: string }[] } | null }; reader: { inventory(): { name: string | null }[]; chat(n: number): { text: string }[] } } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => { await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']); return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false); };
    const type = async (t: string) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(400); await page.keyboard.type(t, { delay: 25 }); await page.keyboard.press('Enter'); await page.waitForTimeout(1400); };
    const clean = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('guam leaf')).length);
    const herbs = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '') === 'Herb').length);
    await page.goto(`${base}/bot.html`); await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20'); await page.reload(); await boot();
    let backIn = false; for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    for (let i = 0; i < 8; i++) await type('::give unidentified_guam');
    await type('::advancestat herblore 10');
    console.log(`unidentified herbs: ${await herbs()}`);
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Herblore/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'Herbalist' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Herbalist started...`);
    const deadline = Date.now() + minutes * 60_000; let done = 0, lastLogged = 0;
    while (Date.now() < deadline && done === 0) {
        await page.waitForTimeout(5000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const chat = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.chat(2).map(c => c.text).join(' | '));
        console.log(`  [diag] herbs ${await herbs()} clean ${await clean()} | chat: ${chat}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('Herbalist crashed');
        done = await clean();
    }
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (done === 0) fail('no identified herbs — self-op did not work');
    console.log('\nresult: Herbalist identified herbs — PASS');
} finally { await browser.close(); }
