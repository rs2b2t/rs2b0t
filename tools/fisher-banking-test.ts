// Validates the Fisher preset's location banking (plan: fisher-location-banking).
// Four modes against a local engine (see tools/fishing-test.ts for the harness
// pattern):
//   schema — no login: Fisher shows the 'Fishing location' dropdown (Auto,
//            5 options), Miner does not
//   away   — Auto outside every known region logs the drop-mode determination
//   walkin — forced 'Draynor Village' from the bank walks itself to the spots
//   cycle  — the real thing at Draynor on Auto: auto-detect -> fill -> bank at
//            the booth -> deposit raw fish only -> walk back -> resume
//
// Usage: bun tools/fisher-banking-test.ts [mode] [minutes] [base-url]

import { chromium } from 'playwright-core';

import { FISHING_LOCATIONS } from '../src/bot/scripts/FishingLocations.js';

const mode = process.argv[2] ?? 'cycle';
const minutes = parseFloat(process.argv[3] ?? '25');
const base = process.argv[4] ?? 'http://localhost:8888';
const username = `fb${Date.now().toString(36).slice(-8)}`;

const TELE_LUMBRIDGE = '::tele 0,50,50,20,20'; // (3220,3220)
const TELE_DRAYNOR_SPOTS = '::tele 0,48,50,14,31'; // (3086,3231) — the spot cluster
const TELE_DRAYNOR_BANK = '::tele 0,48,50,20,43'; // (3092,3243) — the booth stand guess

function fail(msg: string): never {
    console.error(`FAIL(${mode}): ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { inventory(): { name: string | null }[]; worldTile(): { x: number; z: number } | null };
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
    const selectScript = async (category: RegExp, card: string) => {
        await page.getByRole('button', { name: 'Browse…' }).click();
        await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
        await page.getByRole('button', { name: category }).click();
        // anchor to the card's leading name — descriptions mention other scripts
        await page.locator('.rs2b0t-library-card', { hasText: new RegExp(`^${card}`) }).click();
        await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
        const current = await page.textContent('.rs2b0t-current-script');
        if (current !== card) fail(`expected ${card} selected, got "${current}"`);
    };
    const settingLabels = () => page.$$eval('.rs2b0t-setting .rs2b0t-setting-label', els => els.map(e => e.textContent ?? ''));
    const botLog = () => page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
    const rawCount = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().filter(i => (i.name ?? '').toLowerCase().includes('raw')).length);
    const hasNet = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.inventory().some(i => (i.name ?? '').toLowerCase().includes('net')));
    const tile = () => page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.worldTile());

    /** Poll the bot log (printing new lines) until `want` matches a line or timeout. */
    let lastLogged = 0;
    const waitForLog = async (want: RegExp, timeoutMs: number): Promise<string | null> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const log = await botLog();
            for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
            lastLogged = log.length;
            const hit = log.find(l => want.test(l));
            if (hit) return hit;
            if (await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'crashed')) fail('script crashed');
            await page.waitForTimeout(4000);
        }
        return null;
    };

    /** Fresh account on the mainland with a net, standing at `tele`. */
    const standAt = async (tele: string, url = `${base}/bot.html`) => {
        await page.goto(url);
        await boot();
        if (!(await login())) fail('login failed');
        await type(TELE_LUMBRIDGE);
        await page.reload();
        await boot();
        let backIn = false;
        for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
        if (!backIn) fail('relogin failed');
        await type('::give net');
        await type(tele);
    };

    if (mode === 'schema') {
        await page.goto(`${base}/bot.html`);
        await boot();
        await selectScript(/^Mining/, 'Miner');
        const minerLabels = await settingLabels();
        if (minerLabels.some(l => l.includes('Fishing location'))) fail(`Miner shows a Fishing location row: [${minerLabels.join(', ')}]`);
        console.log(`Miner settings: [${minerLabels.join(', ')}] — no location row, correct`);

        await selectScript(/^Fishing/, 'Fisher');
        const fisherLabels = await settingLabels();
        if (!fisherLabels.some(l => l.includes('Fishing location'))) fail(`Fisher lacks the Fishing location row: [${fisherLabels.join(', ')}]`);
        const dropdown = await page.$$eval('.rs2b0t-setting select', els => els.map(s => ({ value: (s as HTMLSelectElement).value, options: Array.from((s as HTMLSelectElement).options as unknown as ArrayLike<HTMLOptionElement>, o => o.value) })));
        const loc = dropdown.find(d => d.options.includes('Draynor Village'));
        if (!loc) fail('no <select> with Draynor Village found');
        if (loc.value !== 'Auto') fail(`dropdown default is ${loc.value}, expected Auto`);
        if (loc.options.join('|') !== 'Auto|Draynor Village|Catherby|Fishing Guild|None') fail(`options are [${loc.options.join(', ')}]`);
        console.log(`Fisher dropdown renders: [${loc.options.join(', ')}], default ${loc.value}`);
        console.log('\nresult: schema mode — PASS');
    } else if (mode === 'away') {
        await standAt(TELE_LUMBRIDGE);
        await selectScript(/^Fishing/, 'Fisher');
        await page.getByRole('button', { name: 'Start' }).click();
        if (!(await waitForLog(/no known fishing location here — dropping/, 60000))) fail('drop-mode determination log never appeared');
        console.log('\nresult: away mode (Auto at Lumbridge -> drop mode) — PASS');
    } else if (mode === 'walkin') {
        await standAt(TELE_DRAYNOR_BANK, `${base}/bot.html?Fisher.location=Draynor%20Village`);
        await selectScript(/^Fishing/, 'Fisher');
        await page.getByRole('button', { name: 'Start' }).click();
        const locLine = await waitForLog(/location: Draynor Village — banking the catch/, 45000);
        if (!locLine) fail('forced-location log never appeared');
        if (locLine.includes('auto-detected')) fail('forced location wrongly logged as auto-detected');
        const deadline = Date.now() + 240000;
        let arrived = false;
        while (Date.now() < deadline && !arrived) {
            await page.waitForTimeout(5000);
            const t = await tile();
            if (t) console.log(`  [tile] ${t.x},${t.z}`);
            arrived = t !== null && Math.max(Math.abs(t.x - 3086), Math.abs(t.z - 3231)) <= 8;
        }
        if (!arrived) fail('never reached the Draynor spot cluster from the bank');
        console.log('\nresult: walkin mode (bank -> spots under forced location) — PASS');
    } else if (mode === 'cycle') {
        await standAt(TELE_DRAYNOR_SPOTS);
        await selectScript(/^Fishing/, 'Fisher');
        await page.getByRole('button', { name: 'Start' }).click();
        console.log(`Fisher started at the Draynor spots (Auto), running up to ${minutes}min...`);

        if (!(await waitForLog(/location: Draynor Village \(auto-detected\) — banking the catch/, 60000))) fail('auto-detection log never appeared');

        // the UNVERIFIED warning must track the table row's verified flag
        const draynorVerified = FISHING_LOCATIONS.find(l => l.name === 'Draynor Village')!.verified;
        const warned = (await botLog()).some(l => /UNVERIFIED — watch the first bank run/.test(l));
        if (draynorVerified && warned) fail('verified row still logs the UNVERIFIED warning');
        if (!draynorVerified && !warned) fail('unverified row never logged the UNVERIFIED warning');

        const bankedLine = await waitForLog(/banked \d+ \*raw\*/, minutes * 60_000);
        if (!bankedLine) {
            await page.screenshot({ path: 'out/fisher-banking-test.png' });
            fail('no bank-cycle completion within the budget (see out/fisher-banking-test.png and the [bot] log above)');
        }
        console.log(`  bank trip: "${bankedLine}"`);
        if (!(await hasNet())) fail('net missing from inventory after the deposit — deposit filter too broad');

        // deposit happened before that log line; the pack should be (nearly)
        // fish-free now and refill as fishing resumes
        const afterDeposit = await rawCount();
        if (afterDeposit > 2) fail(`still ${afterDeposit} raw fish right after the deposit`);
        const deadline = Date.now() + 300000;
        let resumed = false;
        while (Date.now() < deadline && !resumed) {
            await page.waitForTimeout(5000);
            const log = await botLog();
            for (const line of log.slice(lastLogged)) console.log(`  [bot] ${line}`);
            lastLogged = log.length;
            resumed = (await rawCount()) > 0;
        }
        if (!resumed) fail('fishing never resumed after the bank trip');

        await page.screenshot({ path: 'out/fisher-banking-test.png' });
        console.log('\nresult: cycle mode (auto-detect -> fill -> bank -> deposit raw only -> resume) — PASS');
    } else {
        fail(`unknown mode '${mode}' (schema|away|walkin|cycle)`);
    }
} finally {
    await browser.close();
}
