import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 3 });
const username = `fish${Date.now().toString(36).slice(-7)}`;

const FISH_TELE = '::tele 0,51,49,3,12';

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const hasFish = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().some(i => (i.name ?? '').toLowerCase().includes('raw')));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: 1400 });
    await type(page, '::give net', 1400);
    await type(page, FISH_TELE, 1400);

    const spots = await page.evaluate(() => {
        const r = (globalThis as never as Rs2b0t).rs2b0t.reader;
        const t = r.worldTile();
        return r.npcs().filter(n => n.name === 'Fishing spot' && n.ops.some(o => o === 'Net'))
            .map(n => `${n.tile.x},${n.tile.z}(d${t ? Math.max(Math.abs(n.tile.x - t.x), Math.abs(n.tile.z - t.z)) : '?'})`);
    });
    console.log(`net fishing spots near (3267,3148): ${spots.length ? spots.join(' ') : 'NONE'}`);
    if (spots.length === 0) fail('no Net fishing spots at the tele spot');

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Fishing/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'Fisher' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.rs2b0t-current-script');
    if (current !== 'Fisher') fail(`expected Fisher selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Fisher started, running up to ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let caught = false;
    let lastLogged = 0;
    while (Date.now() < deadline && !caught) {
        await page.waitForTimeout(8000);
        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = log.length;
        const diag = await page.evaluate(() => {
            const r = (globalThis as never as Rs2b0t).rs2b0t.reader;
            const t = r.worldTile();
            const chat = r.chat(3).map(c => c.text).join(' | ');
            const raw = r.inventory().filter(i => (i.name ?? '').toLowerCase().includes('raw')).length;
            return `tile ${t ? `${t.x},${t.z}` : '?'} raw-fish ${raw} | chat: ${chat}`;
        });
        console.log(`  [diag] ${diag}`);
        if (await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'crashed')) fail('Fisher crashed');
        caught = await hasFish();
    }

    await page.screenshot({ path: 'out/fishing-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (!caught) fail('no raw fish in inventory — fishing did not work');
    console.log('\nresult: Fisher caught fish at the Al Kharid net spot — PASS');
} finally {
    await browser.close();
}
