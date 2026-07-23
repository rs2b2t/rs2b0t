import { boot, fail, launchBrowser, login, parseArgs } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';
const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 5 });
const username = `cb${Date.now().toString(36).slice(-7)}`;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const type = async (t: string, d = 1100) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(300); await page.keyboard.type(t, { delay: 20 }); await page.keyboard.press('Enter'); await page.waitForTimeout(d); };
    const herbs = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('herb')).length);
    const used = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().length);
    const where = () => page.evaluate(() => { const t = (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile(); return t ? `${t.x},${t.z}${t.z > 6400 ? ' (dungeon)' : ' (surface)'}` : '?'; });
    await page.goto(`${base}/bot.html`); await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await type('::tele 0,50,50,20,20'); await page.reload(); await boot(page);
    let backIn = false; for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(page, username); }
    if (!backIn) fail('relogin failed');
    for (const s of ['attack','strength','defence','hitpoints']) await type(`::advancestat ${s} 90`); await type('::tele 0,48,155,38,8');
    for (let i = 0; i < 34 && (await used()) < 28; i++) await type('::give unidentified_guam', 450);
    console.log(`pack: ${await used()} used, ${await herbs()} herbs, at ${await where()}`);
    if (await used() < 28) fail(`pack not full (${await used()}/28) — can't trigger BankRun`);

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'ChaosDruidKiller' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log('started full — expecting a bank run...');
    const deadline = Date.now() + minutes * 60_000; let deposited = false, returned = false, lastLogged = 0, reachedSurface = false;
    while (Date.now() < deadline && !returned) {
        await page.waitForTimeout(6000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const w = await where(); const h = await herbs();
        console.log(`  [diag] ${w}  herbs ${h}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('crashed');
        if (w.includes('surface')) reachedSurface = true;
        if (reachedSurface && h === 0) deposited = true;
        if (deposited && w.includes('dungeon')) returned = true;
    }
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (!reachedSurface) fail('never climbed to the surface');
    if (!deposited) fail('herbs not deposited at the bank');
    console.log(returned ? '\nresult: full bank round-trip (climb→bank→deposit→climb down→return) — PASS' : '\nresult: climbed out + deposited; still returning when time ended — PARTIAL');
} finally { await browser.close(); }
