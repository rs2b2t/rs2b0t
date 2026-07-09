// Headless live smoke for the Maze random event. Boots the WebGL client
// headlessly (SwiftShader), logs in (auto-creates), teleports off Tutorial
// Island, starts a host bot so the RandomEvents supervisor gets the loop, then
// fires the maze debugproc (::~maze) and waits for handleMaze to replay the
// hardcoded route and Touch the shrine ("maze solved — returned").
//
// Requires the local engine running + the local build deployed:
//   cd ~/code/rs2b2t-engine && npm run quickstart          (web :8890)
//   ENGINE_DIR=~/code/rs2b2t-engine sh tools/deploy-local.sh
//
// Usage: bun tools/maze-test.ts [base-url] [username] [runs]
//   base-url default http://localhost:8890 ; runs = how many ::~maze attempts
//   (each is a random spawn corner) — default 4 to exercise multiple corners.

import { chromium } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `mz${Date.now().toString(36).slice(-7)}`;
const runs = Number(process.argv[4] || 4);

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(script: unknown): void; stop?: () => void; ctx: { log: { msg: string }[] } | null };
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
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    const loginRetry = async (attempts: number): Promise<boolean> => {
        for (let i = 0; i < attempts; i++) {
            if (await login()) { return true; }
            await page.waitForTimeout(3000);
        }
        return false;
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await loginRetry(6))) fail('login failed (is the engine up + local build deployed?)');
    await type('::tele 0,50,50,20,20'); // off Tutorial Island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('relogin failed');
    console.log('logged in off Tutorial Island');

    // Start a host bot so the RandomEvents supervisor (first task) runs. Bypass
    // the UI selectors — drive the runner directly with the registry entry.
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ChickenKiller')); });
    await page.waitForTimeout(1500);

    let solved = 0;
    for (let run = 1; run <= runs; run++) {
        const before = (await logLines()).length;
        await type('::~maze');
        const t0 = await tile();
        console.log(`run ${run}: fired ::~maze (tile ${t0 ? `${t0.x},${t0.z}` : '?'})`);
        // Wait for the handler to finish this maze (solved) or give up (still inside).
        const done = await page.waitForFunction(n => {
            const log = (globalThis as never as R).rs2b0t.runner.ctx?.log ?? [];
            return log.slice(n).some(l => /maze solved — returned|maze — still inside/.test(l.msg));
        }, before, { timeout: 240000 }).then(() => true).catch(() => false);
        const mazeLog = (await logLines()).slice(before).filter(l => /maze/i.test(l));
        for (const l of mazeLog) console.log(`  ${l}`);
        const ok = mazeLog.some(l => /maze solved — returned/.test(l));
        if (ok) { solved++; console.log(`  run ${run}: SOLVED`); }
        else { console.log(`  run ${run}: NOT solved${done ? ' (gave up inside)' : ' (timeout)'}`); await page.screenshot({ path: `out/maze-test-${run}.png` }); }
        await page.waitForTimeout(2000);
    }

    console.log(`\n${solved}/${runs} maze runs solved`);
    if (solved === 0) fail('no maze run solved');
    console.log('PASS');
} finally {
    await browser.close();
}
