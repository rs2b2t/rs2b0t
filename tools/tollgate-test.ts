import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `tg${Date.now().toString(36).slice(-7)}`;
const GATE_X = 3268;
const WEST = '::tele 0,51,50,0,27';

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { name: string | null; count: number }[] };
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
    const coins = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory().filter(i => i.name?.toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0));
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const startWalk = () => page.evaluate(() => { const p = (globalThis as never as { rs2b0t: { runner: { start(s: unknown): void }; registry: { get(n: string): unknown } } }).rs2b0t; p.runner.start(p.registry.get('WalkTo')); });
    const stopWalk = () => page.evaluate(() => (globalThis as never as { rs2b0t: { runner: { stop(): void } } }).rs2b0t.runner.stop());

    await page.goto(`${base}/bot.html?WalkTo.destination=Al Kharid`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }

    await type(WEST);
    const startB = await tile();
    if (!startB || Math.abs(startB.x - 3267) > 3) { fail(`west tele failed (at ${JSON.stringify(startB)})`); }
    if ((await coins()) >= 10) { fail('expected <10 coins for phase B'); }
    console.log(`Phase B: at ${JSON.stringify(startB)}, coins ${await coins()}`);
    startWalk();
    const throughGate = (t: { x: number; z: number }): boolean => t.x >= GATE_X && t.x <= GATE_X + 1 && t.z >= 3225 && t.z <= 3230;
    let avoided = false;
    for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(2000);
        if ((await logLines()).some(l => /toll gate.*skipping|need 10 coins/i.test(l))) { avoided = true; }
        const t = await tile();
        if (t && throughGate(t)) { fail(`crossed the gate with <10 coins (at ${JSON.stringify(t)})`); }
        if (t && t.z > 3300) { avoided = true; }
        if (avoided) { break; }
    }
    stopWalk();
    const afterB = await tile();
    console.log(`Phase B: avoided=${avoided}, at ${JSON.stringify(afterB)}`);
    if (!avoided) { fail('did not observe the toll-gate avoidance with <10 coins'); }
    if (afterB && throughGate(afterB)) { fail('standing in the gate without paying'); }

    await type(WEST);
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
    console.log('--- bot log tail ---');
    for (const l of (await logLines()).slice(-16)) { console.log(`  ${l}`); }
    console.log(`Phase A: crossed=${crossed}, coins ${coinsBefore} -> ${coinsAfter}, at ${JSON.stringify(await tile())}`);
    if (!crossed) { await page.screenshot({ path: 'out/tollgate-test.png' }); fail('did not cross the gate with >=10 coins'); }
    if (coinsAfter !== coinsBefore - 10) { fail(`expected coins to drop by 10 (from ${coinsBefore}), got ${coinsAfter}`); }

    console.log('PASS');
} finally {
    await browser.close();
}
