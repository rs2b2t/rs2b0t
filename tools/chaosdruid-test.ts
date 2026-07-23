import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';
const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 2.5 });
const username = `cd${Date.now().toString(36).slice(-7)}`;
const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    const lootCount = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => { const n = (i.name ?? '').toLowerCase(); return n.includes('herb') || n.includes('law rune'); }).length);
    await page.goto(`${base}/bot.html`); await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: 1300 });
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) await type(page, `::advancestat ${s} 80`, 1300);
    await type(page, '::tele 0,48,155,38,8', 1300);
    const druidsSeen = await page
        .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === 'Chaos druid').length > 0, undefined, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);
    const at = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`chaos druids seen: ${druidsSeen} at (${at?.x},${at?.z},${at?.level})`);
    if (!druidsSeen) fail('no Chaos druids at the tele spot');
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'ChaosDruidKiller' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log('ChaosDruidKiller started...');
    const deadline = Date.now() + minutes * 60_000; let looted = 0, lastLogged = 0;
    while (Date.now() < deadline && looted === 0) {
        await page.waitForTimeout(7000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`); lastLogged = log.length;
        const d = await page.evaluate(() => { const r = (globalThis as never as Rs2b0t).rs2b0t.reader; const t = r.worldTile(); return `tile ${t ? `${t.x},${t.z}` : '?'} | chat: ${r.chat(2).map(c => c.text).join(' | ')}`; });
        console.log(`  [diag] loot-in-pack ${await lootCount()} ${d}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('crashed');
        looted = await lootCount();
    }
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    if (looted === 0) fail('no herbs/law runes looted — combat+loot did not work');
    console.log('\nresult: ChaosDruidKiller killed druids and looted herbs/law runes — PASS');
} finally { await browser.close(); }
