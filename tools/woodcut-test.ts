// Slice 4 functional test: fresh account, unlock tabs (tele off Tutorial
// Island + re-login), ::give an axe, anchor near trees, run Woodcutter and
// assert logs get chopped and dropped.
//
// Usage: bun tools/woodcut-test.ts [minutes] [base-url] [username]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '5');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = process.argv[4] ?? `wood${Date.now().toString(36).slice(-7)}`;

// trees north-east of Lumbridge: world (3230, 3250) -> 0,50,50,30,50
const TELE = '::tele 0,50,50,30,50';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        host: { tickCount: number };
        runner: { state: string; ctx: { log: { level: string; msg: string }[]; loopCount: number } | null };
        reader: { inventory(): { name: string | null }[]; locs(): { name: string | null; distance: number; ops: (string | null)[] }[]; worldTile(): { x: number; z: number } | null };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Lcb).lcbuddy;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 })
            .then(() => true)
            .catch(() => false);
    };

    const type = async (text: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1200);
    };

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('first login failed');
    console.log(`logged in as '${username}'`);

    await type(TELE);

    await page.reload();
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');

    const invTab = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.client.sideIcon[3] ?? -1) !== -1);
    if (!invTab) fail('sidebar tabs still locked after re-login');
    console.log('tabs unlocked');

    await type('::give bronze_axe');
    const hasAxe = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().some(i => i.name?.toLowerCase().includes('axe')));
    if (!hasAxe) {
        const inv = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().map(i => i.name));
        fail(`::give bronze_axe did not land (inventory: [${inv.join(', ')}]) — staffModLevel < 3?`);
    }
    console.log('axe acquired');

    const trees = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.locs().filter(l => l.name === 'Tree' && l.distance <= 15).length);
    console.log(`trees within 15 tiles: ${trees}`);
    if (trees === 0) {
        const near = await page.evaluate(() =>
            (globalThis as never as Lcb).lcbuddy.reader
                .locs()
                .filter(l => l.name?.toLowerCase().includes('tree'))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 8)
                .map(l => `${l.name}@${l.distance}`)
        );
        fail(`no plain Trees nearby; tree-ish locs: [${near.join(', ')}]`);
    }

    await page.selectOption('.lcb-select', 'Woodcutter');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Woodcutter started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);

        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Lcb).lcbuddy;
            return { state: runner.state, log: runner.ctx?.log ?? [] };
        });

        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot:${line.level}] ${line.msg}`);
        }
        lastLogged = snap.log.length;

        if (snap.state === 'crashed') {
            await page.screenshot({ path: 'out/woodcut-test.png' });
            fail('script crashed — see log above');
        }
    }

    await page.screenshot({ path: 'out/woodcut-test.png' });

    const summary = await page.evaluate(() => {
        const log = ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg);
        return {
            dropped: log.filter(l => l === 'dropped all logs').length,
            levelups: log.filter(l => l.startsWith('level up!')).length
        };
    });

    await page.getByRole('button', { name: 'Stop' }).click();

    console.log(`\nresult: ${summary.dropped} full-inventory drops, ${summary.levelups} level-ups (screenshot: out/woodcut-test.png)`);
    if (summary.dropped === 0 && summary.levelups === 0) fail('no woodcutting progress observed');
    console.log('PASS');
} finally {
    await browser.close();
}
