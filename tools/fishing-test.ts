// Validates the GatheringBot's NPC path via the Fisher preset at the Al Kharid
// net/bait fishing spot: pick it from the library, run it, assert raw fish end
// up in the inventory (find spot -> Net -> shrimp -> repeat).
//
// Usage: bun tools/fishing-test.ts [minutes] [base-url]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '3');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `fish${Date.now().toString(36).slice(-7)}`;

const FISH_TELE = '::tele 0,51,49,3,12'; // Al Kharid riverside (3267,3148)

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { inventory(): { name: string | null }[]; npcs(): { name: string | null; ops: (string | null)[]; tile: { x: number; z: number } }[]; worldTile(): { x: number; z: number } | null; chat(n: number): { text: string }[] };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 25 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1400);
    };
    const hasFish = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().some(i => (i.name ?? '').toLowerCase().includes('raw')));

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    await type('::give net');
    await type(FISH_TELE);

    const spots = await page.evaluate(() => {
        const r = (globalThis as never as Lcb).lcbuddy.reader;
        const t = r.worldTile();
        return r.npcs().filter(n => n.name === 'Fishing spot' && n.ops.some(o => o === 'Net'))
            .map(n => `${n.tile.x},${n.tile.z}(d${t ? Math.max(Math.abs(n.tile.x - t.x), Math.abs(n.tile.z - t.z)) : '?'})`);
    });
    console.log(`net fishing spots near (3267,3148): ${spots.length ? spots.join(' ') : 'NONE'}`);
    if (spots.length === 0) fail('no Net fishing spots at the tele spot');

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Fishing/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'Fisher' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.lcb-current-script');
    if (current !== 'Fisher') fail(`expected Fisher selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Fisher started, running up to ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let caught = false;
    let lastLogged = 0;
    while (Date.now() < deadline && !caught) {
        await page.waitForTimeout(8000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const diag = await page.evaluate(() => {
            const r = (globalThis as never as Lcb).lcbuddy.reader;
            const t = r.worldTile();
            const chat = r.chat(3).map(c => c.text).join(' | ');
            const raw = r.inventory().filter(i => (i.name ?? '').toLowerCase().includes('raw')).length;
            return `tile ${t ? `${t.x},${t.z}` : '?'} raw-fish ${raw} | chat: ${chat}`;
        });
        console.log(`  [diag] ${diag}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('Fisher crashed');
        caught = await hasFish();
    }

    await page.screenshot({ path: 'out/fishing-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (!caught) fail('no raw fish in inventory — fishing did not work');
    console.log('\nresult: Fisher caught fish at the Al Kharid net spot — PASS');
} finally {
    await browser.close();
}
