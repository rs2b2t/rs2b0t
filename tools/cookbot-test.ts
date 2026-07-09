// Headless live smoke for CookBot. Boots the WebGL client (SwiftShader),
// logs in (auto-creates), teleports off Tutorial Island, maxes stats (Thieving
// for the Guard pickpocket), teleports to the East Ardougne market anchor, starts
// the bot, and watches for the restock -> pickpocket cycle (and a flee if a guard
// retaliates).
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/ardythiever-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `ck${Date.now().toString(36).slice(-7)}`;

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

    // Max stats on the clean post-relogin state (Thieving 99 — Guard needs 40).
    // Clear any blocking dialog programmatically (more reliable than keypresses)
    // — ::~maxme spews level-up dialogs that otherwise swallow the next command.
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as { rs2b0t: { actions?: { continueDialog?: () => boolean } } }).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    await type('::~maxme');                 // Cooking 99 + everything
    await clearDialogs();
    // Catherby bank stand (2809,3441) — mapsquare 43_53, local (57,49).
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,43,53,57,49');
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 2809) <= 8 && Math.abs(at.z - 3441) <= 8) { break; }
        await clearDialogs();
    }
    console.log(`at Catherby bank: ${at ? `${at.x},${at.z}` : '?'}`);
    if (!at || Math.abs(at.x - 2809) > 8 || Math.abs(at.z - 3441) > 8) { fail(`Catherby tele failed (at ${at ? `${at.x},${at.z}` : '?'})`); }
    await clearDialogs();

    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('CookBot')); });
    console.log('started CookBot — watching (no fish seeded → validates the bank half: reach bank, open booth, attempt withdraw, graceful idle)');

    const before = (await logLines()).length;
    let started = false, bankReached = false, boothFail = false, cooked = false;
    for (let i = 0; i < 45; i++) { // ~90s
        await page.waitForTimeout(2000);
        const lines = (await logLines()).slice(before);
        for (const l of lines) {
            if (/CookBot cooking/i.test(l)) { started = true; }
            if (/in the bank — idling/i.test(l)) { bankReached = true; } // reached+opened+withdraw-attempted
            if (/could not open the bank/i.test(l)) { boothFail = true; }
            if (/cooking (raw|salmon)/i.test(l)) { cooked = true; }
        }
        if (bankReached || cooked) { break; }
    }

    const tail = (await logLines()).slice(-20);
    console.log('--- recent bot log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    const here = await tile();
    console.log(`started=${started} bankReached=${bankReached} boothFail=${boothFail} cooked=${cooked} pos=${here ? `${here.x},${here.z}` : '?'}`);
    if (boothFail) { await page.screenshot({ path: 'out/cookbot-test.png' }); fail('CookBot could not open the Catherby bank booth (name/tile?)'); }
    if (!bankReached && !cooked) { await page.screenshot({ path: 'out/cookbot-test.png' }); fail('CookBot did not reach + open the bank within the window'); }
    console.log('PASS (bank half — reached Catherby bank, opened booth, attempted withdraw; cooking needs fish in the bank, validate live)');
} finally {
    await browser.close();
}
