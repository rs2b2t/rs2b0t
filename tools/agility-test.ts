import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';
const LAP_XP = 80;
const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 4 });
const username = `agil${Date.now().toString(36).slice(-7)}`;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const agiXp = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.stat(16).xp);
    await page.goto(`${base}/bot.html`); await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: 1400 });
    await type(page, '::advancestat agility 10', 1400);
    await type(page, '::tele 0,38,53,42,44', 1400);
    const baseXp = await agiXp();
    console.log(`at gnome course, agility xp baseline ${baseXp}`);
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Agility/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'GnomeCourse' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log('GnomeCourse started...');
    const deadline = Date.now() + minutes * 60_000; let gained = false, lastLogged = 0;
    while (Date.now() < deadline && !gained) {
        await page.waitForTimeout(6000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const d = await page.evaluate(() => { const r = (globalThis as never as Rs2b0t).rs2b0t.reader; const t = r.worldTile(); return `tile ${t ? `${t.x},${t.z}` : '?'} | chat: ${r.chat(2).map(c => c.text).join(' | ')}`; });
        console.log(`  [diag] agiXp ${await agiXp()} (base ${baseXp}) ${d}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('GnomeCourse crashed');
        gained = (await agiXp()) >= baseXp + LAP_XP;
    }
    const total = (await agiXp()) - baseXp;
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (!gained) fail(`no full lap — only ${total}xp gained (need ${LAP_XP}: obstacles + lap bonus)`);
    console.log(`\nresult: GnomeCourse completed a full lap (+${total}xp incl. lap bonus) — PASS`);
} finally { await browser.close(); }
