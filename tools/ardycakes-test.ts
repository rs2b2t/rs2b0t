// Headless live smoke for ArdyCakes. Boots the WebGL client (SwiftShader),
// logs in (auto-creates), teleports off Tutorial Island, maxes stats, teleports
// to the East Ardougne market, starts the bot, and watches the steal -> bank
// cycle. Refusal resets and guard responses are stochastic (the Baker/guards
// decide) — they're reported but not required for a PASS.
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/ardycakes-test.ts [base-url] [username] [Fight|Flee]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `ct${Date.now().toString(36).slice(-7)}`;
const mode = process.argv[4] === 'Fight' ? 'Fight' : 'Flee';

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

    await page.goto(`${base}/bot.html${mode === 'Fight' ? '?ArdyCakes.guardResponse=Fight' : ''}`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island');

    // Max stats on the clean post-relogin state (Thieving 5 needed; Fight mode
    // wants combat stats too). Clear level-up dialogs programmatically.
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    await type('::~maxme');
    await clearDialogs();
    // Teleport to the market square near the Baker's stall.
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,41,51,37,42'); // East Ardougne market ~ (2661,3306)
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 2661) <= 8 && Math.abs(at.z - 3306) <= 8) { break; }
        await clearDialogs();
    }
    console.log(`at market: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - 2661) > 8 || Math.abs(at.z - 3306) > 8) { fail(`market tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyCakes')); });
    console.log(`started ArdyCakes (${mode}) — watching for a full steal->bank cycle`);

    const before = (await logLines()).length;
    const seen = { stocked: false, banked: false, reset: false, combat: false };
    // ~12 min: Flee mode pays ~25s per guard catch (kite + return + lockout),
    // so a full 28-slot pack can take 8-10 min in a crowded market.
    for (let i = 0; i < 360; i++) {
        await page.waitForTimeout(2000);
        const lines = (await logLines()).slice(before);
        for (const l of lines) {
            if (/stocked \d+ stall food/.test(l)) { seen.stocked = true; }
            if (/banked \d+ cakes/.test(l) && !/nothing deposited/.test(l)) { seen.banked = true; }
            if (/swapping to the stand/.test(l)) { seen.reset = true; }
            if (/kiting the guard|fighting back against/.test(l)) { seen.combat = true; }
        }
        if (seen.banked) { break; }
        if (i > 0 && i % 30 === 0) { console.log(`  t+${i * 2}s ${JSON.stringify(seen)}`); }
    }

    const tail = (await logLines()).slice(-60);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`seen: ${JSON.stringify(seen)}`);
    if (!seen.stocked && !seen.banked) {
        await page.screenshot({ path: 'out/ardycakes-test.png' });
        fail('never stocked or banked — steal loop is not landing cakes');
    }
    if (!seen.banked) {
        await page.screenshot({ path: 'out/ardycakes-test.png' });
        fail('no successful bank trip within the watch window');
    }
    console.log(`PASS: ArdyCakes ${mode} — full pack stolen and banked${seen.reset ? ' (incl. a refusal reset)' : ''}${seen.combat ? ' (incl. a guard response)' : ''}`);
} finally {
    await browser.close();
}
