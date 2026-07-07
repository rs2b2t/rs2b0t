// Auto-relogin check (Slice 7): start a script, force-close the game socket,
// and assert the watchdog logs us back in and resumes the run.
//
// Usage: bun tools/relogin-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `relog${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; stream: { close(): void } | null; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { level: string; msg: string }[] } | null };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    await page.goto(`${base}/bot.html`);
    await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });

    await page.evaluate(
        ([user, pass]) => {
            const { client } = (globalThis as never as Lcb).lcbuddy;
            client.loginUser = user;
            client.loginPass = pass;
            void client.login(user, pass, false);
        },
        [username, 'test']
    );
    await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 30000 });
    console.log(`logged in as '${username}'`);

    await page.selectOption('.lcb-select', 'DebugBot');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'running', undefined, { timeout: 10000 });
    await page.waitForTimeout(3000);

    // force a session loss that reaches the title screen. (A plain socket
    // close is healed by the client's NATIVE reconnect — login(.., true) —
    // without ever leaving the game, verified experimentally; logout() is
    // the path that ends at the title with credentials cleared, which is
    // exactly what AutoRelogin exists to recover.)
    await page.evaluate(() => (globalThis as never as { lcbuddy: { client: { logout(): Promise<void> } } }).lcbuddy.client.logout());
    console.log('forced logout; waiting for auto-relogin...');

    await page.waitForFunction(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).some(l => l.msg.includes('auto-relogin: back ingame')), undefined, { timeout: 150000 });

    const state = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state);
    const lines = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).filter(l => l.msg.includes('auto-relogin')).map(l => l.msg));
    console.log(lines.join('\n'));
    if (state !== 'running') fail(`script not resumed after relogin (state: ${state})`);

    console.log('PASS');
} finally {
    await browser.close();
}
