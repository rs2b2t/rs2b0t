// Validates ChaosDruidKiller combat + loot at the Edgeville dungeon druids.
// (Banking round-trip is validated separately by chaosdruid-bank-test.ts.)
import { chromium } from 'playwright-core';
const minutes = parseFloat(process.argv[2] ?? '2.5');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `cd${Date.now().toString(36).slice(-7)}`;
function fail(m: string): never { console.error(`FAIL: ${m}`); process.exit(1); }
type Lcb = { lcbuddy: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> }; runner: { state: string; ctx: { log: { msg: string }[] } | null }; reader: { inventory(): { name: string | null }[]; npcs(): { name: string | null }[]; worldTile(): { x: number; z: number } | null; chat(n: number): { text: string }[] } } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => { await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']); return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false); };
    const type = async (t: string) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(400); await page.keyboard.type(t, { delay: 25 }); await page.keyboard.press('Enter'); await page.waitForTimeout(1300); };
    const lootCount = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => { const n = (i.name ?? '').toLowerCase(); return n.includes('herb') || n.includes('law rune'); }).length);
    await page.goto(`${base}/bot.html`); await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20'); await page.reload(); await boot();
    let backIn = false; for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) await type(`::advancestat ${s} 80`);
    await type('::tele 0,48,155,38,8'); // (3110,9928) among the druids
    await page.waitForTimeout(1500);
    const druids = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.npcs().filter(n => n.name === 'Chaos druid').length);
    console.log(`chaos druids in scene: ${druids}`);
    if (druids === 0) fail('no Chaos druids at the tele spot');
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'ChaosDruidKiller' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`ChaosDruidKiller started...`);
    const deadline = Date.now() + minutes * 60_000; let looted = 0, lastLogged = 0;
    while (Date.now() < deadline && looted === 0) {
        await page.waitForTimeout(7000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const d = await page.evaluate(() => { const r = (globalThis as never as Lcb).lcbuddy.reader; const t = r.worldTile(); return `tile ${t ? `${t.x},${t.z}` : '?'} | chat: ${r.chat(2).map(c => c.text).join(' | ')}`; });
        console.log(`  [diag] loot-in-pack ${await lootCount()} ${d}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('crashed');
        looted = await lootCount();
    }
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (looted === 0) fail('no herbs/law runes looted — combat+loot did not work');
    console.log('\nresult: ChaosDruidKiller killed druids and looted herbs/law runes — PASS');
} finally { await browser.close(); }
