// Headless live smoke for FlaxSpinner (Seers Village). Boots the WebGL client,
// logs in, teleports off Tutorial Island, seeds flax into the BANK (before maxme,
// which swallows the next typed command), maxes stats, teleports to the Seers
// bank, runs the bot, and asserts a full withdraw → climb up → spin → climb down
// → bank cycle: bow string appears, the player visits level 1 and returns to
// level 0, and the bot stops cleanly once the seeded flax is spent.
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/flax-spinner-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `fs${Date.now().toString(36).slice(-7)}`;

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

const sub = (inv: Inv[], s: string) => inv.filter(i => (i.name ?? '').toLowerCase().includes(s)).reduce((n, i) => n + Math.max(1, i.count), 0);

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
    const inv = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory());
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const runState = () => page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state);
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); } });

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    // Seed exactly ONE pack of flax (28) so trip 2 hits the out-of-flax stop.
    await type('::~bankitem flax 28');
    await type('::~maxme');
    await clearDialogs();

    // Seers bank (2722,3493): region 42,54 local 34,37.
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,42,54,34,37');
        await page.waitForTimeout(1500);
        at = await tile();
        if (at && Math.abs(at.x - 2722) <= 8 && Math.abs(at.z - 3493) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 2722) > 8) { fail(`Seers bank tele failed (at ${JSON.stringify(at)})`); }
    console.log(`at Seers bank ${JSON.stringify(at)}`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('FlaxSpinner')); });
    console.log('started FlaxSpinner (Flax) — watching ~200s');

    let peakString = 0, wentUp = false, cameBackDown = false, sawFlax = false, stopped = false;
    for (let i = 0; i < 100; i++) { // ~200s
        await page.waitForTimeout(2000);
        const v = await inv();
        peakString = Math.max(peakString, sub(v, 'bow string'));
        if (sub(v, 'flax') > 0) { sawFlax = true; }
        const t = await tile();
        if (t?.level === 1) { wentUp = true; }
        if (wentUp && t?.level === 0) { cameBackDown = true; }
        if (await runState() === 'stopped') { stopped = true; }
        if (i % 5 === 0) { console.log(`  t=${i * 2}s pos=${t ? `${t.x},${t.z},${t.level}` : '?'} flax=${sub(v, 'flax')} string=${peakString} state=${await runState()}`); }
        if (stopped && peakString >= 20) { break; }
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-16)) { console.log(`  ${l}`); }
    console.log(`sawFlax=${sawFlax} wentUp=${wentUp} cameBackDown=${cameBackDown} peakBowString=${peakString} stopped=${stopped}`);
    if (!sawFlax) { fail('flax was never withdrawn from the bank'); }
    if (!wentUp) { await page.screenshot({ path: 'out/flax-spinner-test.png' }); fail('bot never reached the spinning wheel floor (level 1)'); }
    if (peakString < 20) { await page.screenshot({ path: 'out/flax-spinner-test.png' }); fail(`did not spin a full pack (peak ${peakString} bow string)`); }
    if (!cameBackDown) { fail('bot did not climb back down to level 0'); }
    if (!stopped) { fail('bot did not stop cleanly after the seeded flax ran out'); }
    console.log('PASS (Seers flax spin: withdraw 28 flax → climb up → Spin-X into bow string → climb down → bank → stop on out-of-flax)');
} finally {
    await browser.close();
}
