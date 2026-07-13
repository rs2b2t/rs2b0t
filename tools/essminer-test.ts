// Headless live smoke for EssMiner: seeds a Rune pickaxe in the BANK (so the
// GetPick withdraw path is exercised), completes Rune Mysteries via setvar
// (relog required — quest journal colours only recompute on login), then
// asserts a DOUBLE cycle: teleport in (mapsquare 45_75) → pack fills (27 ess,
// pick carried) → portal back → deposit logged → pick retained → second
// teleport. Cheats go BEFORE ::~maxme (maxme's level-up dialogs swallow the
// next typed command).
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/essminer-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `em${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Inv = { name: string | null; count: number };
type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): Inv[] };
        actions?: { continueDialog?: () => boolean };
    };
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const inv = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory());
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); } });
    const relog = async () => {
        await page.reload();
        await boot();
        let ok = false;
        for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(5000); ok = await login(); }
        return ok;
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    if (!(await relog())) { fail('relogin failed (off-island)'); }
    console.log('logged in off Tutorial Island');

    // Seed BEFORE maxme (maxme swallows the next typed cheat), then relog so
    // the quest journal colour recomputes and Quests.status() sees 'complete'.
    await type('::~bankitem rune_pickaxe 1');
    await type('::setvar runemysteries 6');
    if (!(await relog())) { fail('relogin failed (post-setvar)'); }
    await type('::~maxme');
    await clearDialogs();

    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,50,53,53,26'); // Varrock East bank stand (3253,3418)
        await page.waitForTimeout(1500);
        at = await tile();
        if (at && Math.abs(at.x - 3253) <= 6 && Math.abs(at.z - 3418) <= 6) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 3253) > 6) { fail(`bank tele failed (at ${JSON.stringify(at)})`); }
    console.log(`at Varrock East bank: ${JSON.stringify(at)}`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('EssMiner')); });
    console.log('started EssMiner — watching for a double cycle (~10 min cap)...');

    const inMine = (t: { x: number; z: number } | null) => t !== null && (t.x >> 6) === 45 && (t.z >> 6) === 75;
    const essOf = (items: Inv[]) => items.filter(i => /^rune essence$/i.test(i.name ?? '')).length;
    const hasPick = (items: Inv[]) => items.some(i => /rune pickaxe/i.test(i.name ?? ''));

    let sawWithdraw = false, sawMine = false, sawFull = false, sawBank = false, pickKept = false, sawSecond = false;
    let lastNote = 0;
    for (let i = 0; i < 300; i++) { // ~600s
        await page.waitForTimeout(2000);
        const lines = await logLines();
        if (lines.some(l => /withdrew Rune pickaxe/i.test(l))) { sawWithdraw = true; }
        if (lines.some(l => /^mining rune essence/i.test(l))) { sawMine = true; }
        if (lines.some(l => /banked \d+ rune essence \(trip 1\)/i.test(l))) { sawBank = true; }
        const t = await tile();
        const items = await inv();
        if (inMine(t)) {
            if (sawBank) { sawSecond = true; }
            if (essOf(items) >= 27) { sawFull = true; }
        }
        if (sawBank && hasPick(items)) { pickKept = true; }
        if (i - lastNote >= 30) { lastNote = i; console.log(`  ...${i * 2}s: withdraw=${sawWithdraw} mine=${sawMine} full=${sawFull} bank=${sawBank} pick=${pickKept} second=${sawSecond} at=${JSON.stringify(t)} ess=${essOf(items)}`); }
        if (sawSecond && pickKept) { break; }
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-20)) { console.log(`  ${l}`); }
    console.log(`withdraw=${sawWithdraw} mine=${sawMine} full=${sawFull} bank=${sawBank} pickKept=${pickKept} second=${sawSecond}`);
    if (!sawWithdraw) { await page.screenshot({ path: 'out/essminer-test.png' }); fail('never withdrew the seeded Rune pickaxe from the bank'); }
    if (!sawMine) { await page.screenshot({ path: 'out/essminer-test.png' }); fail('never started mining (teleport failed?)'); }
    if (!sawFull) { await page.screenshot({ path: 'out/essminer-test.png' }); fail('pack never filled with 27 rune essence'); }
    if (!sawBank) { await page.screenshot({ path: 'out/essminer-test.png' }); fail('never banked trip 1'); }
    if (!pickKept) { await page.screenshot({ path: 'out/essminer-test.png' }); fail('pickaxe was not retained after the deposit'); }
    if (!sawSecond) { await page.screenshot({ path: 'out/essminer-test.png' }); fail('second teleport never happened'); }
    console.log('PASS');
} finally {
    await browser.close();
}
