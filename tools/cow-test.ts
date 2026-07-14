// CowKiller functional test: log in, unlock off Tutorial Island, teleport to
// the Lumbridge east cow field, run CowKiller through the real Browse…->card
// ->Start panel flow, and assert a kill+loot cycle happens repeatedly.
//
// Usage: PATH="/opt/homebrew/opt/node@24/bin:$PATH" bun tools/cow-test.ts [minutes] [base-url] [username]

import { boot, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 6 });
const username = rest[0] ?? `cow${Date.now().toString(36).slice(-7)}`;

// Lumbridge east cow field. Confirmed via tools/scout-npcs.ts: jagex coord
// 0,50,51,55,6 lands at world (3255,3270), with 6-7 attackable Cows within
// leash range and no Chickens nearby (the brief's guessed 0,50,51,20,20 is
// actually duck/chicken/sheep territory at world (3220,3284) -- no cows).
const TELE = '::tele 0,50,51,55,6';

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    await page.goto(`${base}/bot.html?nodeid=10`);
    await boot(page);

    if (!(await login(page, username))) fail('login failed');
    console.log(`logged in as '${username}'`);

    // fresh accounts spawn tutorial-locked on Tutorial Island (no sidebar
    // tabs -> no inventory component). Teleport off the island and reload +
    // re-login until the tabs unlock (see tools/chicken-test.ts:50-86).
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

    // land exactly on the cow field (re-send: relogin isn't guaranteed to
    // resume precisely on the pre-reload tile)
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

        // Count distinct kill events only -- NOT loot lines. Cows have a 100%
        // drop table (Cow hide + Bones every time), so a single kill produces
        // up to three matching lines ("Cow killed", "looted Bones", "looted Cow
        // hide"); counting those let one kill clear a >=2 bar meant to prove
        // the bot re-engages after a kill.
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
