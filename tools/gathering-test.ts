// Validates the generalized GatheringBot via the Miner preset at the
// Lumbridge Swamp mine: pick it from the library, run it, and assert ore
// ends up in the inventory (mining works: find rock -> Mine -> ore -> repeat,
// handling depletion).
//
// Usage: bun tools/gathering-test.ts [minutes] [base-url]

import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 4 });
const username = `mine${Date.now().toString(36).slice(-7)}`;

const MINE_TELE = '::tele 0,50,49,38,24'; // Lumbridge Swamp mine floor near the rock wall

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const hasOre = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().some(i => (i.name ?? '').toLowerCase().includes('ore')));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: 1400 });
    await type(page, '::give rune_pickaxe', 1400);
    await type(page, '::advancestat mining 99', 1400); // the SE swamp mine is mithril (lvl 55+)
    await type(page, MINE_TELE, 1400);

    const rocks = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.locs().filter(l => l.name === 'Rocks' && l.ops.some(o => o === 'Mine')).length);
    console.log(`minable rocks in scene: ${rocks}`);
    if (rocks === 0) fail('no minable Rocks at the tele spot');

    // pick Miner from the library
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Mining/ }).click();
    // exact card-name match — a bare hasText:'Miner' also matches EssMiner's card
    await page.locator('.rs2b0t-library-card', { has: page.locator('.rs2b0t-card-name', { hasText: /^Miner$/ }) }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.rs2b0t-current-script');
    if (current !== 'Miner') fail(`expected Miner selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Miner started, running up to ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let mined = false;
    let lastLogged = 0;
    while (Date.now() < deadline && !mined) {
        await page.waitForTimeout(8000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const diag = await page.evaluate(() => {
            const r = (globalThis as never as Rs2b0t).rs2b0t.reader;
            const t = r.worldTile();
            const m = r.stat(14); // mining
            const chat = r.chat(3).map(c => c.text).join(' | ');
            const nearRock = r.locs().filter(l => l.name === 'Rocks' && l.ops.includes('Mine') && t).sort((a, b) => Math.max(Math.abs(a.tile.x - t!.x), Math.abs(a.tile.z - t!.z)) - Math.max(Math.abs(b.tile.x - t!.x), Math.abs(b.tile.z - t!.z)))[0];
            const slots = nearRock ? nearRock.ops.map((o, i) => `${i + 1}:${o ?? '-'}`).join(' ') : 'none';
            return `tile ${t ? `${t.x},${t.z}` : '?'} mining ${m.base}(${m.xp}xp) rock ${nearRock ? `${nearRock.tile.x},${nearRock.tile.z} ops[${slots}]` : 'none'} | chat: ${chat}`;
        });
        console.log(`  [diag] ${diag}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('Miner crashed');
        mined = await hasOre();
    }

    await page.screenshot({ path: 'out/gathering-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (!mined) fail('no ore in inventory — mining did not work');
    console.log('\nresult: Miner mined ore at the swamp mine — PASS');
} finally {
    await browser.close();
}
