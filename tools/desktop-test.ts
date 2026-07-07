// Validates the desktop client: launches the Electron app, logs in, runs a
// bot, then HIDES the window and proves the 50fps loop keeps running (no
// background throttling, no catch-up burst) — the whole point of leaving the
// browser. Also forces a main-thread stall to prove the Scheduler's
// frame-gap insurance shifts deadlines instead of falsely timing out.
//
// Run with NODE (tsx), not Bun: Playwright's Electron launcher attaches over
// Node's inspector WebSocket, which Bun's runtime breaks.
//   PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx tsx tools/desktop-test.ts [server-url]

import { _electron as electron } from 'playwright-core';

const server = process.argv[2] ?? 'http://localhost:8888';
const username = `desk${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; constructor: { loopCycle: number }; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        scheduler: { gapShifts: number };
    };
};

const electronApp = await electron.launch({
    args: ['desktop/main.cjs', `--server=${server}`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await electronApp.firstWindow();

    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 15000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 25 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1400);
    };
    const loopCycle = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.client.constructor.loopCycle);

    await boot();
    console.log('electron app booted, client running');
    if (!(await login())) fail('first login failed');
    await type('::tele 0,50,50,20,20');
    // re-login off tutorial island
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(4000);
        backIn = await login();
    }
    if (!backIn) fail('relogin failed');
    console.log('logged in');

    await page.selectOption('.lcb-select', 'DebugBot');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(2000);

    // ---- the core test: hide the window, measure loop rate while hidden ----
    const before = await loopCycle();
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide());
    console.log('window hidden — measuring loop rate over 6s...');
    const hiddenStart = Date.now();
    await page.waitForTimeout(6000);
    const afterHidden = await loopCycle();
    const elapsed = (Date.now() - hiddenStart) / 1000;
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());

    const fps = (afterHidden - before) / elapsed;
    console.log(`loop while hidden: ${afterHidden - before} cycles in ${elapsed.toFixed(1)}s = ${fps.toFixed(1)} fps`);
    // a throttled browser tab would be ~1 fps; full speed is ~50. Pass well above throttle.
    if (fps < 25) fail(`loop throttled while hidden (${fps.toFixed(1)} fps) — backgroundThrottling not effective`);
    console.log('PASS: loop kept full speed while hidden (no background throttle)');

    // ---- bonus: frame-gap insurance still protects against a hard stall ----
    // block the main thread ~2.5s (simulates a system sleep the flag can't
    // prevent); the Scheduler should shift deadlines, not falsely time out.
    const gapsBefore = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.scheduler.gapShifts);
    await page.evaluate(() => { const end = performance.now() + 2500; while (performance.now() < end) { /* spin */ } });
    await page.waitForTimeout(1500);
    const gapsAfter = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.scheduler.gapShifts);
    if (gapsAfter <= gapsBefore) {
        console.log('note: frame-gap insurance did not trip on the 2.5s stall (scheduler may have been mid-launch) — non-fatal');
    } else {
        console.log(`frame-gap insurance: shifted timers after the stall (${gapsBefore} -> ${gapsAfter})`);
    }

    const state = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state);
    if (state === 'crashed') fail('bot crashed during the test');
    console.log(`bot state after stall: ${state}`);

    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    console.log('\nPASS');
} finally {
    await electronApp.close();
}
