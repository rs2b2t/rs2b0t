// Headless smoke: the global `lampSkill` drives the genie/lamp random event.
// Opens bot.html?Global.lampSkill=mining (a URL override on the reserved Global
// namespace), gives a genie Lamp via the item cheat, starts a host bot so the
// RandomEvents supervisor's handleLamp runs, and asserts the lamp is rubbed for
// MINING xp (not the old hardcoded strength).
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/global-settings-test.ts [base-url]

import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = `gs${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
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
    const logs = () => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

    // The URL override sets the GLOBAL lampSkill to mining (?Global.lampSkill=mining).
    await page.goto(`${base}/bot.html?Global.lampSkill=mining`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload(); // keeps the ?Global.lampSkill=mining query
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail('relogin failed'); }
    console.log('logged in off Tutorial Island (Global.lampSkill=mining)');

    // Give a genie Lamp (obj macro_genilamp) on the clean state.
    await type('::~item macro_genilamp 1');
    await page.waitForTimeout(1000);

    // Start a host bot; the RandomEvents supervisor bridges the global lampSkill
    // after onStart, then handleLamp rubs the Lamp.
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ChickenKiller')); });
    console.log('started ChickenKiller — waiting for the lamp to be rubbed');

    const before = (await logs()).length;
    let rubbed = '';
    for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(2000);
        const m = (await logs()).slice(before).map(l => l.match(/rubbed lamp \(\+xp (\w+)\)/i)).find(Boolean);
        if (m) { rubbed = m[1]; break; }
    }

    const tail = (await logs()).slice(-12).filter(l => /lamp|random event/i.test(l));
    console.log('--- log ---');
    for (const l of tail) { console.log(`  ${l}`); }
    console.log(`rubbedFor=${rubbed || '(none)'}`);
    if (rubbed.toLowerCase() !== 'mining') {
        await page.screenshot({ path: 'out/global-settings-test.png' });
        fail(`lamp was not rubbed for mining (got '${rubbed}') — global lampSkill did not drive the genie`);
    }
    console.log('PASS (global lampSkill drove the genie lamp: mining)');
} finally {
    await browser.close();
}
