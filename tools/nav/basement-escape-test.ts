// Live verify for issue #12: webwalk OUT of the Lumbridge castle basement
// (random events teleport bots there; the exit ladder edge was missing from
// the baked graph). Teles into the basement, runs WalkTo -> Lumbridge spawn.
// Usage: bun tools/nav/basement-escape-test.ts [base-url]
import { launchBrowser } from '../lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = `bsm${Date.now().toString(36).slice(-7)}`;
function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(n: string): unknown };
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
    const clearDialogs = () => page.evaluate(async () => { const a = (globalThis as never as R).rs2b0t.actions; for (let i = 0; i < 20; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 200)); } });

    await page.goto(`${base}/bot.html?WalkTo.customTile=3222,3218,0&WalkTo.arriveRadius=4`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    await type('::~maxme');
    await clearDialogs();

    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,50,150,12,15'); // (3212,9615) — the Lumbridge castle basement
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 3212) <= 5 && Math.abs(at.z - 9615) <= 5) { break; }
        await clearDialogs();
    }
    if (!at) { fail('basement tele failed'); }
    console.log(`in the basement: (${at.x},${at.z},${at.level})\n`);

    const logsBefore = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length);
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('WalkTo')); });
    console.log('started WalkTo -> Lumbridge spawn\n');

    const deadline = Date.now() + 180_000;
    let seen = 0, done = false;
    while (Date.now() < deadline && !done) {
        await page.waitForTimeout(2500);
        const all: string[] = await page.evaluate(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(n).map(l => l.msg), logsBefore);
        for (const l of all.slice(seen)) { console.log(`  ${l}`); }
        seen = all.length;
        const now = await tile();
        if (now && now.z < 4000 && Math.max(Math.abs(now.x - 3222), Math.abs(now.z - 3218)) <= 6) { done = true; }
        if ((await page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state)) !== 'running') { done = true; }
    }
    const fin = await tile();
    const escaped = !!fin && fin.z < 4000 && Math.max(Math.abs(fin.x - 3222), Math.abs(fin.z - 3218)) <= 8;
    console.log(`\nfinal=(${fin?.x},${fin?.z}) escaped=${escaped} => ${escaped ? 'PASS' : 'FAIL'}`);
} finally {
    await browser.close();
}
