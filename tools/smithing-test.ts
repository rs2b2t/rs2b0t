// Headless live smoke for SmithingBot (Varrock West anvil). Boots the WebGL
// client, logs in, teleports off Tutorial Island, SEEDS the bank with bronze
// bars + a hammer (before ::~maxme, which swallows the next typed command),
// maxes stats, teleports to the Varrock West bank, discovers the real Anvil loc
// tile, runs the bot (Bronze → Dagger), and asserts bronze daggers appear from a
// full withdraw → smith → bank cycle.
//
// Requires: engine on :8890 + the local build deployed (deploy-local.sh).
// Usage: bun tools/smithing-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `sm${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Inv = { name: string | null; count: number };
type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): Inv[]; locs(): { name: string | null; tile: { x: number; z: number } }[] };
        actions?: { continueDialog?: () => boolean };
    };
};

const countSub = (inv: Inv[], sub: string): number => inv.filter(i => (i.name ?? '').toLowerCase().includes(sub)).reduce((s, i) => s + Math.max(1, i.count), 0);

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

    await page.goto(`${base}/bot.html?SmithingBot.product=Dagger`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    // Seed bronze bars + a hammer BEFORE maxme (maxme swallows the next command).
    await type('::~bankitem bronze_bar 5000');
    await type('::~bankitem hammer 1');
    await type('::~maxme');
    await clearDialogs();

    // Varrock West bank (3185,3440).
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,49,53,49,48');
        await page.waitForTimeout(1500);
        at = await tile();
        if (at && Math.abs(at.x - 3185) <= 8 && Math.abs(at.z - 3440) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 3185) > 8) { fail(`Varrock West tele failed (at ${JSON.stringify(at)})`); }
    const anvil = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.locs().filter(l => /anvil/i.test(l.name ?? '')).map(l => l.tile)[0] ?? null);
    console.log(`at Varrock West bank ${JSON.stringify(at)}; nearest Anvil loc: ${JSON.stringify(anvil)}`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('SmithingBot')); });
    console.log('started SmithingBot (Bronze → Dagger) — watching ~180s');

    let peakDaggers = 0;
    for (let i = 0; i < 120; i++) { // ~240s
        await page.waitForTimeout(2000);
        peakDaggers = Math.max(peakDaggers, countSub(await inv(), 'dagger'));
        const t = await tile();
        if (i % 6 === 0) { console.log(`  t=${i * 2}s pos=${t ? `${t.x},${t.z}` : '?'} daggers=${peakDaggers} bars=${countSub(await inv(), 'bronze bar')}`); }
        if (peakDaggers >= 20) { break; } // sustained smithing — most of a 27-bar pack, not a one-off
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-16)) { console.log(`  ${l}`); }
    console.log(`peakDaggers=${peakDaggers}`);
    if (peakDaggers < 20) { await page.screenshot({ path: 'out/smithing-test.png' }); fail(`SmithingBot did not sustain smithing (peak ${peakDaggers} daggers — stalled after a batch?)`); }
    console.log('PASS (Varrock smithing: withdraw bars+hammer → smith a full pack of daggers at the anvil)');
} finally {
    await browser.close();
}
