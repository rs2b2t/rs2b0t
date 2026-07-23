import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 8 });
const username = rest[0] ?? `crab${Date.now().toString(36).slice(-7)}`;

const TELE = '::tele 0,42,58,22,8';

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('first login failed');

    await type(page, '::tele 0,50,50,20,20', 1500);
    await page.reload();
    await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(5000);
        backIn = await login(page, username);
    }
    if (!backIn) fail('re-login failed');

    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) {
        await type(page, `::setstat ${s} 40`, 1500);
    }
    await type(page, TELE, 1500);

    const atField = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().some(n => n.name === 'Rocks' || n.name === 'Rock Crab'));
    if (!atField) fail('no rock crabs in scene after teleport — wrong coords?');
    console.log('at the rock crab field');

    await startFromLibrary(page, 'Combat', 'RockCrab');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`RockCrab started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10000);
        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Rs2b0t).rs2b0t;
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
    const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
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
