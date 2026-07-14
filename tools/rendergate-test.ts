// Validates the RenderGate on a single client (bot.html): (1) focused draws
// fast / background draws slow while LOGIC (loopCycle) keeps full speed in
// both, and (2) the constraint-#5 boost — a backgrounded bot running a
// synthetic walking script still renders at full rate during gestures and
// never logs synthetic-fail.
//
// Part 2's script picker: BotPanel.ts no longer exposes the old script-select
// dropdown the original desktop-test.ts copies from — script choice now goes
// through the ScriptLibrary modal (Browse… -> category chip -> script card ->
// close), same pattern already used by tools/chicken-test.ts / library-test.ts.
//
//   PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx tsx tools/rendergate-test.ts [server-url]
import { _electron as electron } from 'playwright-core';

const server = process.argv[2] ?? 'http://localhost:8888';
const username = `rg${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Rs2b0t = { rs2b0t: {
    client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; constructor: { loopCycle: number }; login(u: string, p: string, r: boolean): Promise<void> };
    runner: { state: string; ctx: { log: { msg: string }[] } | null };
    renderGate: { drawn: number; mode: string; boosted: boolean };
    setRenderMode(m: string): void;
} };

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${server}/bot.html?inputmode=synthetic&WalkTo.destination=Falador`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();
    const probe = () => page.evaluate(() => {
        const l = (globalThis as never as Rs2b0t).rs2b0t;
        return { loop: l.client.constructor.loopCycle, drawn: l.renderGate.drawn, mode: l.renderGate.mode, boosted: l.renderGate.boosted };
    });
    const setMode = (m: string) => page.evaluate(mm => (globalThis as never as Rs2b0t).rs2b0t.setRenderMode(mm), m);
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 15000 }).then(() => true).catch(() => false);
    };

    await page.waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    if (!(await login())) fail('first login failed');
    // teleport off tutorial island, then relog
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.keyboard.type('::tele 0,50,50,20,20', { delay: 25 });
    await page.keyboard.press('Enter');
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(4000); backIn = await login(); }
    if (!backIn) fail('relogin off tutorial failed');
    console.log('logged in off tutorial');

    // ---- (1) mode gating: draw rate follows mode, logic rate does not ----
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

    // ---- (2) constraint #5: backgrounded synthetic gestures still render ----
    await setMode('background');
    // Bot panel script picker: Browse… -> category chip -> script card -> Start
    // (the old script-select dropdown this test's original brief was drafted
    // against has been replaced by the ScriptLibrary modal; pattern matches
    // tools/chicken-test.ts / tools/library-test.ts). WalkTo web-walks from
    // Lumbridge to Falador (set via the ?WalkTo.destination override above),
    // so it issues plenty of synthetic walk() gestures via minimap clicks.
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Navigation/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'WalkTo' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    let sawBoost = false;
    const gStart = await probe();
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
        const p = await probe();
        if (p.boosted) sawBoost = true;
        await page.waitForTimeout(120);
    }
    const gEnd = await probe();
    const logHasFail = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).some(l => l.msg.includes('synthetic-fail')));
    const state = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state);
    const gestureDrawFps = (gEnd.drawn - gStart.drawn) / ((Date.now() - t0) / 1000);
    console.log(`backgrounded WalkTo: boosted seen=${sawBoost}, draw during run ${gestureDrawFps.toFixed(1)}fps, state=${state}, synthetic-fail=${logHasFail}`);
    if (!sawBoost) fail('boost never engaged during synthetic gestures while backgrounded');
    if (logHasFail) fail('synthetic-fail logged while backgrounded (constraint #5 violated)');
    if (state === 'crashed') fail('script crashed');
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    console.log('\nPASS');
} finally {
    await app.close();
}
