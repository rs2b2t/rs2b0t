// Slice 3 functional test: log in, ::tele to the Lumbridge east chicken pen,
// run ChickenKiller through the real panel, and report the kill/loot/bury
// cycle. Duration configurable for soak runs.
//
// Usage: bun tools/chicken-test.ts [minutes] [base-url] [username]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '4');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = process.argv[4] ?? `chick${Date.now().toString(36).slice(-7)}`;

// pen at world (3232, 3298) -> jagex coords 0,50,51,32,34
const TELE = '::tele 0,50,51,32,34';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        host: { tickCount: number };
        runner: { state: string; ctx: { log: { level: string; msg: string }[]; loopCount: number } | null };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

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

    // new accounts spawn tutorial-locked on Tutorial Island (no sidebar tabs
    // -> no inventory component). the login script only (re)starts the
    // tutorial when standing on the island, so teleport away and re-login to
    // get the full tab set.
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(600);
    await page.keyboard.type(TELE, { delay: 35 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);

    await page.reload();
    await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });

    // the server takes a few seconds to process the disconnect; retry past
    // the already-online window
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Lcb).lcbuddy;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        backIn = await page
            .waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 10000 })
            .then(() => true)
            .catch(() => false);
    }
    if (!backIn) fail('could not re-login after tutorial unlock');

    const invTab = await page.evaluate(() => ((globalThis as never as { lcbuddy: { client: { sideIcon: number[] } } }).lcbuddy.client.sideIcon[3] ?? -1) !== -1);
    console.log(`re-logged in; inventory tab ${invTab ? 'present' : 'STILL MISSING'}`);
    if (!invTab) fail('re-login off tutorial island did not unlock sidebar tabs');

    const arrived = await page
        .waitForFunction(
            () => {
                const rows = Array.from(document.querySelectorAll('.rs2b0t-row'));
                const tile = rows.find(r => r.querySelector('.rs2b0t-key')?.textContent === 'tile')?.querySelector('.rs2b0t-value')?.textContent ?? '';
                return tile.startsWith('323') || tile.startsWith('322');
            },
            undefined,
            { timeout: 15000 }
        )
        .then(() => true)
        .catch(() => false);

    const tileNow = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('.rs2b0t-row'));
        return rows.find(r => r.querySelector('.rs2b0t-key')?.textContent === 'tile')?.querySelector('.rs2b0t-value')?.textContent ?? '?';
    });
    console.log(`teleport ${arrived ? 'ok' : 'DID NOT TAKE'} — tile now ${tileNow}`);
    if (!arrived) {
        const chat = await page.evaluate(() => Array.from(document.querySelectorAll('.rs2b0t-chat-line')).map(n => n.textContent));
        fail(`still at ${tileNow}; chat: ${chat.join(' | ')}`);
    }

    await page.waitForTimeout(2000);

    // start ChickenKiller through the panel: Browse… -> Combat category -> card -> Start
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'ChickenKiller' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.rs2b0t-current-script');
    if (current !== 'ChickenKiller') fail(`expected ChickenKiller selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`ChickenKiller started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);

        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Lcb).lcbuddy;
            return { state: runner.state, log: runner.ctx?.log ?? [], loops: runner.ctx?.loopCount ?? 0 };
        });

        const fresh = snap.log.slice(lastLogged);
        lastLogged = snap.log.length;
        for (const line of fresh) {
            console.log(`  [bot:${line.level}] ${line.msg}`);
        }

        if (snap.state === 'crashed') {
            await page.screenshot({ path: 'out/chicken-test.png' });
            fail('script crashed — see log above');
        }
    }

    await page.screenshot({ path: 'out/chicken-test.png' });

    const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
    const buried = log.filter(l => l === 'buried bones').length;
    console.log(`\nresult: ${buried} bones buried over ${minutes}min (screenshot: out/chicken-test.png)`);

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'stopped', undefined, { timeout: 10000 }).catch(() => {});

    if (buried === 0) fail('no bones buried — cycle did not complete');
    console.log('PASS');
} finally {
    await browser.close();
}
