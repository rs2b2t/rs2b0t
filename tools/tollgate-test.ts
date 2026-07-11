// Headless live smoke for the Al Kharid toll-gate conditional crossing.
// Phase B (0 coins): walk toward Al Kharid from the Lumbridge side; assert the
// walker SKIPS the toll gate (logs the skip) and does NOT end up east of it.
// Phase A (100 coins): walk again; assert coins drop by 10 and we cross east.
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/tollgate-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `tg${Date.now().toString(36).slice(-7)}`;
const GATE_X = 3268;
// (3264,3227) — Lumbridge side, 4 tiles west of the gate. Must be >=3 tiles
// out: starting 0-2 tiles from the approach puts the start within the walker's
// on-path CORRIDOR of the post-gate tiles (the Al Kharid wall forces the route
// straight south along x=3268 right after the gate), which snaps the follow
// index past the crossing before it fires. 4 tiles out is still an immediate,
// unavoidable gate crossing but leaves the crossing handler room to trigger.
const WEST = '::tele 0,51,50,0,27';

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { name: string | null; count: number }[] };
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
    const coins = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory().filter(i => i.name?.toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0));
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const startWalk = () => page.evaluate(() => { const p = (globalThis as never as { rs2b0t: { runner: { start(s: unknown): void }; registry: { get(n: string): unknown } } }).rs2b0t; p.runner.start(p.registry.get('WalkTo')); });
    const stopWalk = () => page.evaluate(() => (globalThis as never as { rs2b0t: { runner: { stop(): void } } }).rs2b0t.runner.stop());

    // WalkTo destination = Al Kharid (bank 3269,3167), east of the gate.
    await page.goto(`${base}/bot.html?WalkTo.destination=Al Kharid`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }

    // ---- Phase B: 0 coins -> must skip the gate ----
    await type(WEST);
    const startB = await tile();
    if (!startB || Math.abs(startB.x - 3267) > 3) { fail(`west tele failed (at ${JSON.stringify(startB)})`); }
    if ((await coins()) >= 10) { fail('expected <10 coins for phase B'); }
    console.log(`Phase B: at ${JSON.stringify(startB)}, coins ${await coins()}`);
    startWalk();
    let skipped = false;
    for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(2000);
        if ((await logLines()).some(l => /toll gate.*skipping|need 10 coins/i.test(l))) { skipped = true; }
        const t = await tile();
        if (t && t.x > GATE_X) { fail(`crossed the gate with <10 coins (at ${JSON.stringify(t)})`); }
        if (skipped) { break; }
    }
    stopWalk();
    const afterB = await tile();
    console.log(`Phase B: skipped=${skipped}, at ${JSON.stringify(afterB)}`);
    if (!skipped) { fail('did not observe the toll-gate skip with <10 coins'); }
    if (afterB && afterB.x > GATE_X) { fail('ended east of the gate without paying'); }

    // ---- Phase A: 100 coins -> pay 10 and cross ----
    await type(WEST); // back to the west side
    await type('::~item coins 100');
    const coinsBefore = await coins();
    if (coinsBefore < 10) { fail(`coin seed failed (have ${coinsBefore})`); }
    console.log(`Phase A: coins ${coinsBefore}, at ${JSON.stringify(await tile())}`);
    startWalk();
    let crossed = false;
    for (let i = 0; i < 60; i++) {
        await page.waitForTimeout(2000);
        const t = await tile();
        if (t && t.x > GATE_X) { crossed = true; break; }
    }
    stopWalk();
    const coinsAfter = await coins();
    console.log(`--- bot log tail ---`);
    for (const l of (await logLines()).slice(-16)) { console.log(`  ${l}`); }
    console.log(`Phase A: crossed=${crossed}, coins ${coinsBefore} -> ${coinsAfter}, at ${JSON.stringify(await tile())}`);
    if (!crossed) { await page.screenshot({ path: 'out/tollgate-test.png' }); fail('did not cross the gate with >=10 coins'); }
    if (coinsAfter !== coinsBefore - 10) { fail(`expected coins to drop by 10 (from ${coinsBefore}), got ${coinsAfter}`); }

    console.log('PASS');
} finally {
    await browser.close();
}
