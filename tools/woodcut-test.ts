import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 5 });
const username = rest[0] ?? `wood${Date.now().toString(36).slice(-7)}`;

const TELE = '::tele 0,50,50,30,50';

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('first login failed');
    console.log(`logged in as '${username}'`);

    await type(page, TELE, 1200);

    await page.reload();
    await boot(page);
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login(page, username);
    }
    if (!backIn) fail('re-login failed');

    const invTab = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.client.sideIcon[3] ?? -1) !== -1);
    if (!invTab) fail('sidebar tabs still locked after re-login');
    console.log('tabs unlocked');

    await type(page, '::give bronze_axe', 1200);
    const hasAxe = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().some(i => i.name?.toLowerCase().includes('axe')));
    if (!hasAxe) {
        const inv = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().map(i => i.name));
        fail(`::give bronze_axe did not land (inventory: [${inv.join(', ')}]) — staffModLevel < 3?`);
    }
    console.log('axe acquired');

    const trees = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.locs().filter(l => l.name === 'Tree' && l.distance <= 15).length);
    console.log(`trees within 15 tiles: ${trees}`);
    if (trees === 0) {
        const near = await page.evaluate(() =>
            (globalThis as never as Rs2b0t).rs2b0t.reader
                .locs()
                .filter(l => l.name?.toLowerCase().includes('tree'))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 8)
                .map(l => `${l.name}@${l.distance}`)
        );
        fail(`no plain Trees nearby; tree-ish locs: [${near.join(', ')}]`);
    }

    await startFromLibrary(page, 'Woodcutting', 'Woodcutter');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`Woodcutter started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);

        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Rs2b0t).rs2b0t;
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
        const log = ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
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
