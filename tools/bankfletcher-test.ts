// Headless live smoke for BankFletcher. Boots the WebGL client (SwiftShader),
// logs in (auto-creates), teleports off Tutorial Island, SEEDS the bank with logs
// + a knife (::~bankitem), maxes stats (Fletching), teleports to the Varrock West
// bank, starts the bot, and validates a full withdraw→fletch→deposit cycle by
// asserting the chosen PRODUCT appears in the pack. Two phases:
//   phase 1  ?BankFletcher.product=Arrow shafts  → assert "Arrow shaft" in the pack
//   phase 2  ?BankFletcher.product=Short bow      → assert an unstrung shortbow
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/bankfletcher-test.ts [base-url] [username]

import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `bf${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Inv = { name: string | null; count: number };
type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null; bot: Record<string, unknown> | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): Inv[] };
        registry: { get(name: string): unknown };
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
    // Typed command: click the canvas, type, Enter. Debugprocs need '::~'; note
    // ::~maxme spews level-up dialogs that swallow the NEXT typed command — so we
    // seed the bank BEFORE maxme and clear dialogs after it.
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as R).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const inv = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory());
    const countSub = (items: Inv[], sub: string) => items.filter(i => (i.name ?? '').toLowerCase().includes(sub)).reduce((s, i) => s + Math.max(1, i.count), 0);
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const counters = () => page.evaluate(() => {
        const b = (globalThis as never as R).rs2b0t.runner.bot as Record<string, number | string> | null;
        return b ? { made: +b.made, trips: +b.trips, status: String(b.status) } : null;
    });

    // Varrock West bank (3185,3440) — mapsquare 49_53, local (49,48).
    const teleToBank = async () => {
        let at = null as { x: number; z: number; level: number } | null;
        for (let attempt = 0; attempt < 4; attempt++) {
            await type('::tele 0,49,53,49,48');
            await page.waitForTimeout(2000);
            at = await tile();
            if (at && Math.abs(at.x - 3185) <= 8 && Math.abs(at.z - 3440) <= 8) { break; }
            await clearDialogs();
        }
        return at;
    };

    // --- phase 1: Arrow shafts ------------------------------------------------
    await page.goto(`${base}/bot.html?BankFletcher.product=Arrow shafts`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    // Seed the bank BEFORE maxme (maxme's dialogs would swallow these commands).
    await type('::~bankitem logs 5000');
    await type('::~bankitem knife 1');
    await type('::~maxme'); // Fletching 99 + everything
    await clearDialogs();

    let at = await teleToBank();
    console.log(`at Varrock West bank: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - 3185) > 8 || Math.abs(at.z - 3440) > 8) { fail(`Varrock West tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('BankFletcher')); });
    console.log('started BankFletcher (product=Arrow shafts) — watching for arrow shafts + a full cycle');

    let sawShafts = false, boothFail = false;
    for (let i = 0; i < 60; i++) { // ~120s
        await page.waitForTimeout(2000);
        if (i % 5 === 0) { console.log(`  t=${i * 2}s inv=${JSON.stringify((await inv()).map(x => `${x.name}:${x.count}`))}`); }
        if (countSub(await inv(), 'arrow shaft') > 0) { sawShafts = true; break; }
        if ((await logLines()).some(l => /could not open the bank/i.test(l))) { boothFail = true; break; }
    }
    let tail = (await logLines()).slice(-15);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`phase1: sawShafts=${sawShafts} boothFail=${boothFail} counters=${JSON.stringify(await counters())}`);
    if (boothFail) { await page.screenshot({ path: 'out/bankfletcher-test.png' }); fail('BankFletcher could not open the Varrock West bank booth (name/tile?)'); }
    if (!sawShafts) { await page.screenshot({ path: 'out/bankfletcher-test.png' }); fail('BankFletcher did not produce arrow shafts within the window'); }
    console.log('PHASE 1 PASS (arrow shafts produced from a withdraw→fletch cycle)');

    // --- phase 2: Short bow (same account, bank still seeded, already maxed) ---
    await page.goto(`${base}/bot.html?BankFletcher.product=Short bow`);
    await boot();
    backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(3000); backIn = await login(); }
    if (!backIn) { fail('phase 2 relogin failed'); }
    // top up logs in case phase 1 drained the seed, then return to the bank
    await type('::~bankitem logs 5000');
    at = await teleToBank();
    if (!at || Math.abs(at.x - 3185) > 8 || Math.abs(at.z - 3440) > 8) { fail(`phase 2 Varrock West tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('BankFletcher')); });
    console.log('started BankFletcher (product=Short bow) — watching for an unstrung shortbow');

    let sawBow = false;
    for (let i = 0; i < 60; i++) { // ~120s
        await page.waitForTimeout(2000);
        if (countSub(await inv(), 'shortbow') > 0) { sawBow = true; break; }
    }
    tail = (await logLines()).slice(-15);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`phase2: sawBow=${sawBow} counters=${JSON.stringify(await counters())}`);
    if (!sawBow) { await page.screenshot({ path: 'out/bankfletcher-test.png' }); fail('BankFletcher did not produce an unstrung shortbow within the window'); }
    console.log('PHASE 2 PASS (unstrung shortbow produced) — PASS');
} finally {
    await browser.close();
}
