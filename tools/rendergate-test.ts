import { _electron as electron } from 'playwright-core';

const server = process.argv[2] ?? 'http://localhost:8888';
const username = `rg${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Rs2b0t = { rs2b0t: {
    client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; constructor: { loopCycle: number }; login(u: string, p: string, r: boolean): Promise<void> };
    runner: { state: string; ctx: { log: { msg: string }[] } | null };
    renderGate: { drawn: number; mode: string };
    setRenderMode(m: string): void;
} };

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${server}/bot.html?WalkTo.destination=Falador`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();
    const probe = () => page.evaluate(() => {
        const l = (globalThis as never as Rs2b0t).rs2b0t;
        return { loop: l.client.constructor.loopCycle, drawn: l.renderGate.drawn, mode: l.renderGate.mode };
    });
    const setMode = (m: string) => page.evaluate(mm => (globalThis as never as Rs2b0t).rs2b0t.setRenderMode(mm), m);
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 15000 }).then(() => true).catch(() => false);
    };

    await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    if (!(await login())) fail('first login failed');
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.keyboard.type('::tele 0,50,50,20,20', { delay: 25 });
    await page.keyboard.press('Enter');
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(4000); backIn = await login(); }
    if (!backIn) fail('relogin off tutorial failed');
    console.log('logged in off tutorial');

    async function rate(seconds: number) {
        const a = await probe();
        await page.waitForTimeout(seconds * 1000);
        const b = await probe();
        return { drawFps: (b.drawn - a.drawn) / seconds, loopFps: (b.loop - a.loop) / seconds };
    }
    await setMode('focused');
    const foc = await rate(3);
    await setMode('background');
    const bg = await rate(3);
    console.log(`focused: draw ${foc.drawFps.toFixed(1)}fps loop ${foc.loopFps.toFixed(1)}fps | background: draw ${bg.drawFps.toFixed(1)}fps loop ${bg.loopFps.toFixed(1)}fps`);
    if (foc.drawFps < 25) fail(`focused draw fps too low (${foc.drawFps.toFixed(1)})`);
    if (bg.drawFps > 15) fail(`background draw fps not throttled (${bg.drawFps.toFixed(1)})`);
    if (foc.loopFps < 25 || bg.loopFps < 25) fail(`logic starved (focused ${foc.loopFps.toFixed(1)}, bg ${bg.loopFps.toFixed(1)})`);
    console.log('PASS: draw rate follows mode, logic stays full speed');

    await setMode('background');
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Navigation/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'WalkTo' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    const gStart = await probe();
    const t0 = Date.now();
    await page.waitForTimeout(8000);
    const gEnd = await probe();
    const state = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state);
    const runSecs = (Date.now() - t0) / 1000;
    const runDrawFps = (gEnd.drawn - gStart.drawn) / runSecs;
    const runLoopFps = (gEnd.loop - gStart.loop) / runSecs;
    console.log(`backgrounded WalkTo: loop ${runLoopFps.toFixed(1)}fps, draw ${runDrawFps.toFixed(1)}fps, state=${state}`);
    if (runLoopFps < 25) fail(`backgrounded script logic starved (${runLoopFps.toFixed(1)}fps)`);
    if (runDrawFps > 15) fail(`backgrounded draws not throttled while acting (${runDrawFps.toFixed(1)}fps)`);
    if (state === 'crashed') fail('script crashed');
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    console.log('\nPASS');
} finally {
    await app.close();
}
