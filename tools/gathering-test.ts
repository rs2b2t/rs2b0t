// Validates the generalized GatheringBot via the Miner preset at the
// Lumbridge Swamp mine: pick it from the library, run it, and assert ore
// ends up in the inventory (mining works: find rock -> Mine -> ore -> repeat,
// handling depletion).
//
// Usage: bun tools/gathering-test.ts [minutes] [base-url]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '4');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = `mine${Date.now().toString(36).slice(-7)}`;

const MINE_TELE = '::tele 0,50,49,38,24'; // Lumbridge Swamp mine floor near the rock wall

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { inventory(): { name: string | null }[]; locs(): { name: string | null; ops: (string | null)[]; tile: { x: number; z: number } }[]; worldTile(): { x: number; z: number } | null; stat(i: number): { name: string; base: number; xp: number }; chat(n: number): { text: string }[] };
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
    const hasOre = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().some(i => (i.name ?? '').toLowerCase().includes('ore')));

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    await type('::give rune_pickaxe');
    await type('::advancestat mining 99'); // the SE swamp mine is mithril (lvl 55+)
    await type(MINE_TELE);

    const rocks = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.locs().filter(l => l.name === 'Rocks' && l.ops.some(o => o === 'Mine')).length);
    console.log(`minable rocks in scene: ${rocks}`);
    if (rocks === 0) fail('no minable Rocks at the tele spot');

    // pick Miner from the library
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Mining/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'Miner' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.lcb-current-script');
    if (current !== 'Miner') fail(`expected Miner selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Miner started, running up to ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let mined = false;
    let lastLogged = 0;
    while (Date.now() < deadline && !mined) {
        await page.waitForTimeout(8000);
        const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const diag = await page.evaluate(() => {
            const r = (globalThis as never as Lcb).lcbuddy.reader;
            const t = r.worldTile();
            const m = r.stat(14); // mining
            const chat = r.chat(3).map(c => c.text).join(' | ');
            const nearRock = r.locs().filter(l => l.name === 'Rocks' && l.ops.includes('Mine') && t).sort((a, b) => Math.max(Math.abs(a.tile.x - t!.x), Math.abs(a.tile.z - t!.z)) - Math.max(Math.abs(b.tile.x - t!.x), Math.abs(b.tile.z - t!.z)))[0];
            const slots = nearRock ? nearRock.ops.map((o, i) => `${i + 1}:${o ?? '-'}`).join(' ') : 'none';
            return `tile ${t ? `${t.x},${t.z}` : '?'} mining ${m.base}(${m.xp}xp) rock ${nearRock ? `${nearRock.tile.x},${nearRock.tile.z} ops[${slots}]` : 'none'} | chat: ${chat}`;
        });
        console.log(`  [diag] ${diag}`);
        if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('Miner crashed');
        mined = await hasOre();
    }

    await page.screenshot({ path: 'out/gathering-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (!mined) fail('no ore in inventory — mining did not work');
    console.log('\nresult: Miner mined ore at the swamp mine — PASS');
} finally {
    await browser.close();
}
