// Validates the generalized ProcessingBot via the Cook preset at the Al Kharid
// range: give raw shrimps, pick Cook from the library, run it, and assert
// cooked shrimps appear (use raw food on range -> cooked, repeat).
//
// Usage: bun tools/cooking-test.ts [minutes] [base-url]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '2');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `cook${Date.now().toString(36).slice(-7)}`;

const RANGE_TELE = '::tele 0,51,49,9,42'; // (3273,3178), Al Kharid range at (3271,3180)

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { inventory(): { name: string | null }[]; locs(): { name: string | null; tile: { x: number; z: number } }[]; worldTile(): { x: number; z: number } | null; chat(n: number): { text: string }[] };
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
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 25 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1400);
    };
    const cookedCount = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => { const n = (i.name ?? '').toLowerCase(); return n === 'shrimps' || n === 'burnt shrimps'; }).length);
    const rawCount = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '').toLowerCase() === 'raw shrimps').length);

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    for (let i = 0; i < 12; i++) await type('::give raw_shrimp'); // non-stackable: 12 slots
    await type('::advancestat cooking 20'); // reduce burning so a cook clearly completes
    await type(RANGE_TELE);

    const ranges = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.locs().filter(l => l.name === 'Range' || l.name === 'Cooking range').length);
    console.log(`ranges in scene: ${ranges}, raw shrimps: ${await rawCount()}`);
    if (ranges === 0) fail('no Range at the tele spot');

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Cooking/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'Cook' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.lcb-current-script');
    if (current !== 'Cook') fail(`expected Cook selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Cook started, running up to ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let cooked = 0;
    let lastLogged = 0;
    while (Date.now() < deadline && cooked === 0) {
        await page.waitForTimeout(6000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const diag = await page.evaluate(() => {
            const r = (globalThis as never as Lcb).lcbuddy.reader;
            const t = r.worldTile();
            return `tile ${t ? `${t.x},${t.z}` : '?'} | chat: ${r.chat(3).map(c => c.text).join(' | ')}`;
        });
        console.log(`  [diag] raw ${await rawCount()} cooked ${await cookedCount()} | ${diag}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('Cook crashed');
        cooked = await cookedCount();
    }

    await page.screenshot({ path: 'out/cooking-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (cooked === 0) fail('no cooked shrimps — cooking did not work');
    console.log('\nresult: Cook cooked shrimps at the Al Kharid range — PASS');
} finally {
    await browser.close();
}
