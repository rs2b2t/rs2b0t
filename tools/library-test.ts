// Validates the script library modal: open, category-filter, search, and
// selecting a script drives the panel + runner.
//
// Usage: bun tools/library-test.ts [base-url]

import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Rs2b0t = { rs2b0t: { client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> }; runner: { state: string } } };

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });

    // open the library
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    const chips = await page.$$eval('.rs2b0t-chip', els => els.map(e => e.textContent ?? ''));
    console.log(`categories: ${chips.join('  ')}`);
    // 'Develop' died with the retired dev/demo scripts (83203fe) — assert
    // durable categories only.
    for (const want of ['Combat', 'Woodcutting', 'Mining', 'Fishing', 'Navigation', 'Quest']) {
        if (!chips.some(c => c.startsWith(want))) fail(`category chip "${want}" missing`);
    }
    console.log('library: all expected category chips present');

    // filter by Mining -> only the Miner card
    await page.getByRole('button', { name: /^Mining/ }).click();
    let cards = await page.$$eval('.rs2b0t-card-name', els => els.map(e => e.textContent ?? ''));
    if (cards.length !== 1 || !cards[0].includes('Miner')) fail(`Mining filter showed ${JSON.stringify(cards)} (expected just Miner)`);
    console.log('library: Mining filter -> Miner');

    // back to All, search "crab" -> only RockCrab
    await page.getByRole('button', { name: /^All/ }).click();
    await page.fill('.rs2b0t-modal .rs2b0t-input', 'crab');
    await page.waitForTimeout(300);
    cards = await page.$$eval('.rs2b0t-card-name', els => els.map(e => e.textContent ?? ''));
    if (cards.length !== 1 || !cards[0].includes('RockCrab')) fail(`search "crab" showed ${JSON.stringify(cards)} (expected just RockCrab)`);
    console.log('library: search "crab" -> RockCrab');

    // select a card -> modal closes, panel shows it, params render
    await page.fill('.rs2b0t-modal .rs2b0t-input', '');
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.rs2b0t-library-card', { hasText: 'ChickenKiller' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
    const current = await page.textContent('.rs2b0t-current-script');
    if (current !== 'ChickenKiller') fail(`panel shows "${current}" after selecting ChickenKiller`);
    const hasFeatherParam = (await page.locator('.rs2b0t-setting', { hasText: 'Gather feathers?' }).count()) > 0;
    if (!hasFeatherParam) fail('selecting ChickenKiller did not load its parameters');
    console.log('library: selected ChickenKiller -> panel + params updated');

    // selection drives the runner: pick QuestDashboard, log in, Start
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^All/ }).click(); // library remembers the last filter
    await page.locator('.rs2b0t-library-card', { hasText: 'QuestDashboard' }).click();
    await page.evaluate(() => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = `lib${Date.now().toString(36).slice(-5)}`; c.loginPass = 't'; void c.login(c.loginUser, 't', false); });
    await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 20000 }).catch(() => {});
    await page.getByRole('button', { name: 'Start' }).click();
    const running = await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state === 'running', undefined, { timeout: 10000 }).then(() => true).catch(() => false);
    if (!running) fail('selected script did not start');
    console.log('library: selected QuestDashboard started via the runner');

    await page.screenshot({ path: 'out/library-test.png' });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    console.log('\nPASS');
} finally {
    await browser.close();
}
