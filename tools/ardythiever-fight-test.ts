// Headless live smoke for ArdyThiever's FIGHT mode: with
// ?ArdyThiever.guardResponse=Fight, a guard that catches the bot stealing from
// the Baker's stall must be fought and killed IN PLACE — the bot must log the
// fight + the kill, never travel to the kite tile (2655,3298), and resume
// thieving afterwards. Uses a maxme'd account so the level-20 guard dies fast.
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/ardythiever-fight-test.ts [base-url] [username]

import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `af${Date.now().toString(36).slice(-7)}`;
const KITE = { x: 2655, z: 3298 };

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        actions?: { continueDialog?: () => boolean };
    };
};

const browser = await launchBrowser({ swiftshader: true });
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
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); } });

    // URL param = URL-first settings resolution: guardResponse=Fight for this run
    await page.goto(`${base}/bot.html?ArdyThiever.guardResponse=Fight`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload(); // keeps the query string
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    await type('::~maxme');
    await clearDialogs();

    // Tele onto the stall stand; the bot restocks cake there. A patrolling
    // guard that wanders within 5 tiles with LOS blocks the steal and attacks
    // ("Hey! Get your hands off there!") — fight mode must kill it in place.
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,41,51,44,48'); // (2668,3312) stall stand
        await page.waitForTimeout(1500);
        at = await tile();
        if (at && Math.abs(at.x - 2668) <= 8 && Math.abs(at.z - 3312) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 2668) > 8) { fail(`stall tele failed (at ${JSON.stringify(at)})`); }
    console.log(`at stall: ${JSON.stringify(at)}`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyThiever')); });
    console.log('started ArdyThiever (fight mode) — waiting (up to ~12 min) for a guard to catch it...');

    let sawFight = false;
    let sawKill = false;
    let killAt = -1;          // log index of the first kill line
    let resumed = false;      // restock/pickpocket AFTER the kill
    let kited = false;        // must stay false
    let closestToKite = 999;  // must stay > 3
    let lastNote = 0;
    for (let i = 0; i < 360; i++) { // ~720s — a patrolling guard must wander over
        await page.waitForTimeout(2000);
        const lines = await logLines();
        lines.forEach((l, idx) => {
            if (/fighting back against/i.test(l)) { sawFight = true; }
            if (killAt < 0 && /killed the/i.test(l)) { sawKill = true; killAt = idx; }
            if (/kiting the guard/i.test(l)) { kited = true; }
            if (killAt >= 0 && idx > killAt && /restocking|stocked \d+ food|pickpocketed/i.test(l)) { resumed = true; }
        });
        const t = await tile();
        if (t) { closestToKite = Math.min(closestToKite, Math.max(Math.abs(t.x - KITE.x), Math.abs(t.z - KITE.z))); }
        if (i - lastNote >= 30) { lastNote = i; console.log(`  ...${i * 2}s: fight=${sawFight} kill=${sawKill} resumed=${resumed} kiteDist>=${closestToKite} at=${JSON.stringify(t)}`); }
        if (sawKill && resumed) { break; }
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-18)) { console.log(`  ${l}`); }
    console.log(`fight=${sawFight} kill=${sawKill} resumed=${resumed} kited=${kited} closestToKite=${closestToKite}`);
    if (!sawFight) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail('no guard combat / never logged the fight within the window'); }
    if (!sawKill) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail('fought but never logged the kill'); }
    if (kited || closestToKite <= 3) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail(`fled instead of fighting (kited=${kited}, closestToKite=${closestToKite})`); }
    if (!resumed) { await page.screenshot({ path: 'out/ardythiever-fight-test.png' }); fail('killed the guard but never resumed thieving'); }
    console.log('PASS');
} finally {
    await browser.close();
}
