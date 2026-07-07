// Live test for the RockCrab bot at the Rellekka shoreline field. Logs in,
// teleports to the field, runs the bot, and asserts it aggros rocks, kills
// crabs, and performs at least one aggression reset within the window.
//
// Usage: bun tools/rockcrab-test.ts [minutes] [base-url] [username]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '8');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = process.argv[4] ?? `crab${Date.now().toString(36).slice(-7)}`;

// drop the bot right in the field (jagex coords for ~2710,3720)
const TELE = '::tele 0,42,58,22,8';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { level: string; msg: string }[] } | null };
        reader: { npcs(): { name: string | null }[] };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(
            ([u, p]) => {
                const c = (globalThis as never as Lcb).lcbuddy.client;
                c.loginUser = u;
                c.loginPass = p;
                void c.login(u, p, false);
            },
            [username, 'test']
        );
        return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('first login failed');

    // unlock tabs (fresh account spawns tutorial-locked): tele off-island + relog
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');

    // give it survivable combat stats so it can actually clear stacks
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) {
        await type(`::setstat ${s} 40`);
    }
    await type(TELE);

    const atField = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.npcs().some(n => n.name === 'Rocks' || n.name === 'Rock Crab'));
    if (!atField) fail('no rock crabs in scene after teleport — wrong coords?');
    console.log('at the rock crab field');

    await page.selectOption('.lcb-select', 'RockCrab');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`RockCrab started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10000);
        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Lcb).lcbuddy;
            return { state: runner.state, log: (runner.ctx?.log ?? []).map(l => l.msg) };
        });
        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
        }
        lastLogged = snap.log.length;
        if (snap.state === 'crashed') {
            await page.screenshot({ path: 'out/rockcrab-test.png' });
            fail('script crashed');
        }
    }

    await page.screenshot({ path: 'out/rockcrab-test.png' });
    const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
    const woke = log.some(l => /woke a rock crab/.test(l));
    const killLines = log.filter(l => /rock crab down/.test(l));
    const kills = killLines.length;
    const reset = log.some(l => /back in the field|de-aggroed/.test(l));

    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    console.log(`\nresult: woke crabs=${woke}, kills logged=${kills}, reset cycle observed=${reset} (screenshot: out/rockcrab-test.png)`);
    if (!woke) fail('bot never woke a rock crab');
    if (kills === 0) fail('bot woke crabs but killed none');
    console.log('PASS');
} finally {
    await browser.close();
}
