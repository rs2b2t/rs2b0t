// Validates AgilityBot on the Gnome Stronghold course: tele to the log
// balance, run GnomeCourse, and assert a FULL LAP completes. One lap awards
// ~46xp of obstacle xp plus the 39xp completion bonus, so gaining >= 80xp
// proves every obstacle (including the level-2 rope -> climb-down transition
// that used to wedge on the op-less rope mid segments) and the lap rollover.
import { chromium } from 'playwright-core';
const LAP_XP = 80;
const minutes = parseFloat(process.argv[2] ?? '4');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `agil${Date.now().toString(36).slice(-7)}`;
function fail(m: string): never { console.error(`FAIL: ${m}`); process.exit(1); }
type Rs2b0t = { rs2b0t: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> }; runner: { state: string; ctx: { log: { msg: string }[] } | null }; reader: { worldTile(): { x: number; z: number } | null; stat(i: number): { name: string; base: number; xp: number }; chat(n: number): { text: string }[] } } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => { await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']); return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false); };
    const type = async (t: string) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(400); await page.keyboard.type(t, { delay: 25 }); await page.keyboard.press('Enter'); await page.waitForTimeout(1400); };
    const agiXp = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.stat(16).xp); // 16 = agility
    await page.goto(`${base}/bot.html`); await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20'); await page.reload(); await boot();
    let backIn = false; for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    await type('::advancestat agility 10');
    await type('::tele 0,38,53,42,44'); // (2474,3436) at the gnome log balance
    const baseXp = await agiXp();
    console.log(`at gnome course, agility xp baseline ${baseXp}`);
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Agility/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'GnomeCourse' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`GnomeCourse started...`);
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
