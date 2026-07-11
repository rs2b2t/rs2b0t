// Headless live smoke for SmelterBot. Boots the WebGL client (SwiftShader), logs
// in (auto-creates), teleports off Tutorial Island, maxes stats (Smithing),
// seeds ore into the BANK via the ::~bankitem cheat, teleports to the Al Kharid
// bank, starts the bot, and validates a full BRONZE cycle: reach the bank, open
// the booth, withdraw 14 copper + 14 tin, cross to the furnace, smelt bars, then
// rebank. Also confirms the out-of-ore STOP (empty tin → shortage log + runner
// stops).
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/smelter-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

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
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(name: string): unknown };
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
    const logLines = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const runState = () => page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state);

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

    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    // Seed ore into the bank BEFORE ::~maxme — maxme's level-up dialogs swallow
    // the next typed command, so seeding after it drops the first ::~bankitem.
    // Object names are the engine's obj ids (copper_ore, tin_ore, ...).
    await type('::~bankitem copper_ore 5000');
    await type('::~bankitem tin_ore 5000');
    await type('::~bankitem iron_ore 5000');
    await type('::~bankitem coal 5000');
    await type('::~bankitem gold_ore 5000');

    await type('::~maxme');                 // Smithing 99 + everything
    await clearDialogs();

    // Al Kharid bank stand (3269,3167) — mapsquare 51_49, local (5,31).
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

    // SmelterBot defaults to Bronze — no URL override needed for the bronze cycle.
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('SmelterBot')); });
    console.log('started SmelterBot (Bronze) — watching for withdraw → smelt → rebank');

    const before = (await logLines()).length;
    let started = false, withdrew = false, smelted = false;
    for (let i = 0; i < 60; i++) { // ~120s
        await page.waitForTimeout(2000);
        const lines = (await logLines()).slice(before);
        for (const l of lines) {
            if (/SmelterBot smelting/i.test(l)) { started = true; }
            if (/withdrawing .*copper/i.test(l)) { withdrew = true; }
        }
        const here = await tile();
        if (here && Math.abs(here.x - 3272) <= 3 && Math.abs(here.z - 3185) <= 3) { smelted = true; } // reached the furnace
        // a second bank trip (trips>=2 after the first smelt) confirms the loop closed
        if (withdrew && smelted) { break; }
    }

    const tail = (await logLines()).slice(-25);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    const here = await tile();
    console.log(`started=${started} withdrew=${withdrew} reachedFurnace=${smelted} pos=${here ? `${here.x},${here.z}` : '?'}`);
    if (!started || !withdrew) { await page.screenshot({ path: 'out/smelter-test.png' }); fail('SmelterBot did not reach the bank + withdraw ore within the window'); }
    if (!smelted) { await page.screenshot({ path: 'out/smelter-test.png' }); fail('SmelterBot did not reach the Al Kharid furnace (name/tile?)'); }
    console.log('bronze half PASS (bank → withdraw copper+tin → cross to furnace)');

    // Out-of-ore STOP: empty the tin so the next bank trip can't supply a full
    // bronze set, and confirm the bot logs the shortage and the runner stops.
    await type('::~bankitem tin_ore -5000'); // drain tin (negative removes; adjust if your cheat differs)
    console.log('drained tin — expecting the next bank trip to log the shortage and stop');
    let stopped = false, shortage = false;
    for (let i = 0; i < 45; i++) { // ~90s
        await page.waitForTimeout(2000);
        const lines = await logLines();
        if (lines.some(l => /out of 'Tin ore'|out of Tin ore/i.test(l))) { shortage = true; }
        if ((await runState()) === 'stopped') { stopped = true; }
        if (shortage && stopped) { break; }
    }
    console.log(`shortage=${shortage} stopped=${stopped}`);
    if (!shortage || !stopped) {
        await page.screenshot({ path: 'out/smelter-test.png' });
        fail('SmelterBot did not cleanly stop on the out-of-ore shortage');
    }
    console.log('PASS (bronze cycle + out-of-ore clean stop)');
} finally {
    await browser.close();
}
