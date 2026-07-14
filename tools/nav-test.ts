// Slice 5 functional test: fresh account, unlock tabs, run WalkTo through the
// panel and assert the web-walker routes from Lumbridge to Varrock and arrives.
// (Previously drove the multi-leg NavDemo; NavDemo was retired, so this now
// exercises the resilient web-walker over a single cross-region route.)
//
// Usage: bun tools/nav-test.ts [base-url] [username]

import { chromium } from 'playwright-core';
import { startFromLibrary } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `nav${Date.now().toString(36).slice(-7)}`;

// Lumbridge castle courtyard
const TELE = '::tele 0,50,50,22,22';
const DEMO_TIMEOUT_MS = 25 * 60_000;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Rs2b0t = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { level: string; msg: string }[] } | null };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t !== undefined && (globalThis as never as { rs2b0t: { client: { constructor: { loopCycle: number } } } }).rs2b0t.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Rs2b0t).rs2b0t;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 })
            .then(() => true)
            .catch(() => false);
    };

    await page.goto(`${base}/bot.html?WalkTo.destination=Varrock`);
    await boot();
    if (!(await login())) fail('first login failed');
    console.log(`logged in as '${username}'`);

    // unlock sidebar tabs: tele off Tutorial Island, re-login (docs/DEV.md)
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(500);
    await page.keyboard.type(TELE, { delay: 30 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);

    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');
    console.log('re-logged in at Lumbridge');

    await startFromLibrary(page, 'Navigation', 'WalkTo');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log('WalkTo (-> Varrock) started...');

    const deadline = Date.now() + DEMO_TIMEOUT_MS;
    let lastLogged = 0;
    let done = false;

    while (Date.now() < deadline && !done) {
        await page.waitForTimeout(5000);

        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Rs2b0t).rs2b0t;
            return { state: runner.state, log: (runner.ctx?.log ?? []).map(l => `${l.level}: ${l.msg}`) };
        });

        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
        }
        lastLogged = snap.log.length;

        if (snap.state === 'crashed') {
            await page.screenshot({ path: 'out/nav-test.png' });
            fail('WalkTo crashed — see log above');
        }

        done = snap.log.some(l => /arrived at/i.test(l));
    }

    await page.screenshot({ path: 'out/nav-test.png' });
    console.log('screenshot: out/nav-test.png');

    const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
    const arrivals = log.filter(l => /arrived at/i.test(l));

    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (!done) fail(`walk did not arrive within ${DEMO_TIMEOUT_MS / 60000}min (${arrivals.length} arrivals)`);

    console.log(`\nresult: ${arrivals.join(' | ')}`);
    console.log('PASS');
} finally {
    await browser.close();
}
