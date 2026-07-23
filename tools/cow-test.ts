import { boot, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 6 });
const username = rest[0] ?? `cow${Date.now().toString(36).slice(-7)}`;

const TELE = '::tele 0,50,51,55,6';

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    await page.goto(`${base}/bot.html?nodeid=10`);
    await boot(page);

    if (!(await login(page, username))) fail('login failed');
    console.log(`logged in as '${username}'`);

    await type(page, TELE, 1400);
    await page.reload();
    await boot(page);

    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login(page, username);
    }
    if (!backIn) fail('could not re-login after tutorial unlock');

    const invTab = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.client.sideIcon[3] ?? -1) !== -1);
    console.log(`re-logged in; inventory tab ${invTab ? 'present' : 'STILL MISSING'}`);
    if (!invTab) fail('re-login off tutorial island did not unlock sidebar tabs');

    await type(page, TELE, 1400);

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'CowKiller' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.rs2b0t-current-script');
    if (current !== 'CowKiller') fail(`expected CowKiller selected, got "${current}"`);

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`CowKiller started, running up to ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let kills = 0;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Rs2b0t).rs2b0t;
            return { state: runner.state, log: (runner.ctx?.log ?? []).map(l => l.msg) };
        });

        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
        }
        lastLogged = snap.log.length;

        if (snap.state === 'crashed') {
            await page.screenshot({ path: 'out/cow-crash.png' });
            fail('script crashed — see log above');
        }

        kills = snap.log.filter(m => /killed/i.test(m)).length;
        if (kills >= 2) break;
        await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: 'out/cow-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    if (kills < 2) fail(`expected >=2 distinct kills, saw ${kills}`);
    console.log(`PASS: CowKiller ${kills} kills`);
} finally {
    await browser.close();
}
