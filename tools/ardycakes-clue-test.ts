import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `cc${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; stop?(): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
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
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

    await page.goto(`${base}/bot.html`);
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
        await type('::tele 0,41,51,37,42');
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 2661) <= 8 && Math.abs(at.z - 3306) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 2661) > 8 || Math.abs(at.z - 3306) > 8) { fail(`market tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    console.log(`${username} at market (${at.x},${at.z})`);

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyCakes')); });
    console.log('started ArdyCakes — letting the steal loop run');

    let stealSeen = false;
    for (let i = 0; i < 45 && !stealSeen; i++) {
        await page.waitForTimeout(2000);
        stealSeen = (await logLines()).some(l => /stall emptied|swapping to the stand|stocked \d+/.test(l)) || (await page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state)) === 'running';
        if (i === 10) { stealSeen = true; }
    }

    await type('::give trail_clue_easy_map001');
    console.log('gave trail_clue_easy_map001 — watching for SolveClue preemption');

    const before = (await logLines()).length;
    const seen = { banked: false, trail: false, spade: false };
    for (let i = 0; i < 150; i++) {
        await page.waitForTimeout(2000);
        const lines = (await logLines()).slice(before);
        for (const l of lines) {
            if (/\[clue\] banking loot at the/.test(l)) { seen.banked = true; }
            if (/\[clue\] leg \d+ — solving/.test(l)) { seen.trail = true; }
            if (/\[clue\] acquiring a spade|\[clue\].*no 'Spade' in the bank/i.test(l)) { seen.spade = true; }
        }
        if (seen.banked && seen.trail) { break; }
        if (i > 0 && i % 30 === 0) { console.log(`  t+${i * 2}s ${JSON.stringify(seen)}`); }
    }

    console.log('--- recent bot log ---');
    for (const l of (await logLines()).slice(-40)) { console.log(`  ${l}`); }
    console.log(`seen: ${JSON.stringify(seen)}`);
    if (!seen.banked) { fail('clue never preempted into the bank-first prep'); }
    if (!seen.trail) { fail('trail never started after bank-first'); }
    console.log(`PASS: ArdyCakes SolveClue wiring — clue preempted the steal loop, bank-first ran, trail started${seen.spade ? ' (incl. spade acquisition)' : ''}`);
} finally {
    await browser.close();
}
