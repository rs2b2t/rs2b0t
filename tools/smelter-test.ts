import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `sm${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null; inventory(): { name: string | null; count: number }[] };
        registry: { get(name: string): unknown };
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
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const runState = () => page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state);

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    await type('::~bankitem copper_ore 5000');
    await type('::~bankitem tin_ore 14');
    await type('::~bankitem iron_ore 5000');
    await type('::~bankitem coal 5000');
    await type('::~bankitem gold_ore 5000');

    await type('::~maxme');
    await clearDialogs();

    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,51,49,5,31');
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 3269) <= 8 && Math.abs(at.z - 3167) <= 8) { break; }
        await clearDialogs();
    }
    console.log(`at Al Kharid bank: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - 3269) > 8 || Math.abs(at.z - 3167) > 8) { fail(`Al Kharid tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('SmelterBot')); });
    console.log('started SmelterBot (Bronze) — watching for withdraw → smelt → rebank');

    const invBars = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('bronze bar')).reduce((s, i) => s + i.count, 0));
    const before = (await logLines()).length;
    let started = false, reachedFurnace = false, peakBars = 0;
    for (let i = 0; i < 75; i++) {
        await page.waitForTimeout(2000);
        if ((await logLines()).slice(before).some(l => /SmelterBot smelting/i.test(l))) { started = true; }
        const here = await tile();
        if (here && Math.abs(here.x - 3275) <= 1 && Math.abs(here.z - 3185) <= 1) { reachedFurnace = true; }
        peakBars = Math.max(peakBars, await invBars());
        if (i % 5 === 0) { console.log(`  t=${i * 2}s pos=${here ? `${here.x},${here.z}` : '?'} bronzeBars=${await invBars()}`); }
        if (peakBars >= 12) { break; }
    }

    const tail = (await logLines()).slice(-25);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    const here = await tile();
    console.log(`started=${started} reachedFurnace=${reachedFurnace} peakBronzeBars=${peakBars} pos=${here ? `${here.x},${here.z}` : '?'}`);
    if (!started) { await page.screenshot({ path: 'out/smelter-test.png' }); fail('SmelterBot did not start smelting'); }
    if (peakBars === 0) { await page.screenshot({ path: 'out/smelter-test.png' }); fail('SmelterBot produced no bronze bars (furnace interact did not land)'); }
    console.log('bronze half PASS (bank → withdraw copper+tin → smelt bronze bars at the furnace)');

    console.log('first pack smelting; the next bank trip should log the tin shortage and stop');
    let stopped = false, shortage = false;
    for (let i = 0; i < 90; i++) {
        await page.waitForTimeout(2000);
        const lines = await logLines();
        if (lines.some(l => /out of .?Tin ore/i.test(l))) { shortage = true; }
        if ((await runState()) === 'stopped') { stopped = true; }
        if (i % 10 === 0) { console.log(`  oos t=${i * 2}s state=${await runState()} shortage=${shortage}`); }
        if (shortage && stopped) { break; }
    }
    console.log(`out-of-ore: shortage=${shortage} stopped=${stopped}`);
    if (!shortage || !stopped) {
        await page.screenshot({ path: 'out/smelter-test.png' });
        fail('SmelterBot did not cleanly stop when the tin ran out');
    }
    console.log('PASS (Al Kharid bronze: withdraw exact 14/14 → smelt a full pack → bank → stop on out-of-ore)');
} finally {
    await browser.close();
}
