import { launchBrowser } from './lib/harness.js';
const base = 'http://localhost:8890';
const username = `bw${Date.now().toString(36).slice(-7)}`;
function fail(m: string): never { console.error(`FAIL: ${m}`); process.exit(1); }
type Inv = { name: string | null; count: number };
type R = { rs2b0t: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> }; runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null }; registry: { get(n: string): unknown }; reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): Inv[] }; actions?: { continueDialog?: () => boolean } } };
const sub = (inv: Inv[], s: string) => inv.filter(i => (i.name ?? '').toLowerCase().includes(s)).reduce((n, i) => n + Math.max(1, i.count), 0);
const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => { await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']); return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false); };
    const type = async (t: string) => { await page.locator('#canvas').click({ position: { x: 380, y: 250 } }); await page.waitForTimeout(400); await page.keyboard.type(t, { delay: 30 }); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); };
    const inv = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory());
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const clearD = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i=0;i<30;i++){a?.continueDialog?.();await new Promise(r=>setTimeout(r,250));} });
    await page.goto(`${base}/bot.html`); await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); await page.reload(); await boot();
    let backIn = false; for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    await type('::~bankitem copper_ore 5000'); await type('::~bankitem tin_ore 5000'); await type('::~maxme'); await clearD();
    let at = null as { x: number; z: number; level: number } | null;
    for (let a = 0; a < 5; a++) { await type('::tele 0,51,49,7,31'); await page.waitForTimeout(1500); at = await tile(); if (at && at.x === 3271 && at.z === 3167) break; await clearD(); }
    console.log(`positioned at ${JSON.stringify(at)} (target 3271,3167 — the wedge tile)`);
    if (!at || Math.abs(at.x - 3271) > 2 || Math.abs(at.z - 3167) > 2) fail(`could not reach the wedge tile (at ${JSON.stringify(at)})`);
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('SmelterBot')); });
    console.log('started SmelterBot with an EMPTY pack at the wedge tile — first act is a bank open');
    let opened = false, gaveUp = 0;
    for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(2000);
        const ore = sub(await inv(), 'ore');
        if (ore > 0) { opened = true; break; }
        const lines = await logLines();
        gaveUp = lines.filter(l => /giving up after \d+ repaths/.test(l)).length;
        if (i % 4 === 0) { const t = await tile(); console.log(`  t=${i*2}s pos=${t?`${t.x},${t.z}`:'?'} ore=${ore} gaveUps=${gaveUp}`); }
    }
    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-14)) console.log(`  ${l}`);
    console.log(`opened=${opened} gaveUps=${gaveUp}`);
    if (!opened) fail('bank did NOT open from the wedge tile within 60s');
    console.log('PASS (openBooth opened the bank from the non-adjacent wedge tile via OPLOC-first)');
} finally { await browser.close(); }
