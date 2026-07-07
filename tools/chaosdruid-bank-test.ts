// Validates ChaosDruidKiller's banking round-trip: fill the pack with herbs at
// the druid spot, then confirm the bot climbs the ladder, web-walks to the
// Edgeville bank, deposits, climbs back down, and returns underground.
import { chromium } from 'playwright-core';
const minutes = parseFloat(process.argv[2] ?? '5');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `cb${Date.now().toString(36).slice(-7)}`;
function fail(m: string): never { console.error(`FAIL: ${m}`); process.exit(1); }
type Lcb = { lcbuddy: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> }; runner: { state: string; ctx: { log: { msg: string }[] } | null }; reader: { inventory(): { name: string | null }[]; worldTile(): { x: number; z: number } | null } } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => { await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']); return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false); };
    const type = async (t: string, d = 1100) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(300); await page.keyboard.type(t, { delay: 20 }); await page.keyboard.press('Enter'); await page.waitForTimeout(d); };
    const herbs = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('herb')).length);
    const used = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().length);
    const where = () => page.evaluate(() => { const t = (globalThis as never as Lcb).lcbuddy.reader.worldTile(); return t ? `${t.x},${t.z}${t.z > 6400 ? ' (dungeon)' : ' (surface)'}` : '?'; });
    await page.goto(`${base}/bot.html`); await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20'); await page.reload(); await boot();
    let backIn = false; for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    for (const s of ['attack','strength','defence','hitpoints']) await type(`::advancestat ${s} 90`); await type('::tele 0,48,155,38,8'); // among the druids
    for (let i = 0; i < 34 && (await used()) < 28; i++) await type('::give unidentified_guam', 450); // fill the pack with herbs
    console.log(`pack: ${await used()} used, ${await herbs()} herbs, at ${await where()}`);
    if (await used() < 28) fail(`pack not full (${await used()}/28) — can't trigger BankRun`);

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'ChaosDruidKiller' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`started full — expecting a bank run...`);
    const deadline = Date.now() + minutes * 60_000; let deposited = false, returned = false, lastLogged = 0, reachedSurface = false;
    while (Date.now() < deadline && !returned) {
        await page.waitForTimeout(6000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const w = await where(); const h = await herbs();
        console.log(`  [diag] ${w}  herbs ${h}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('crashed');
        if (w.includes('surface')) reachedSurface = true;
        if (reachedSurface && h === 0) deposited = true;
        if (deposited && w.includes('dungeon')) returned = true;
    }
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (!reachedSurface) fail('never climbed to the surface');
    if (!deposited) fail('herbs not deposited at the bank');
    console.log(returned ? '\nresult: full bank round-trip (climb→bank→deposit→climb down→return) — PASS' : '\nresult: climbed out + deposited; still returning when time ended — PARTIAL');
} finally { await browser.close(); }
