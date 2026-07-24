// Runner-crux smoke: withdraws essence in Note mode at Ardougne, ships to Karamja, and
// un-notes at Jiminua. Usage: bun tools/naturecrafter-runner-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 8;
const USER = `nrun${Date.now().toString(36).slice(-6)}`;
const BANK_TELE = '::tele 0,41,51,31,19'; // Ardougne East bank (2655,3283)

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; count: number }[] };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

async function teleTo(page: Page, user: string, tele: string): Promise<void> {
    await type(page, tele);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(3000); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin failed`);
}

function sample(page: Page): Promise<{ pos: { x: number; z: number; level: number } | null; noted: number; unnoted: number; coins: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const ess = items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence');
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            noted: ess.filter(i => i.count > 1).reduce((s, i) => s + i.count, 0),
            unnoted: ess.filter(i => i.count === 1).length,
            coins: items.filter(i => (i.name ?? '').toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-40).map(l => l.msg)
        };
    });
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, USER))) fail('first login failed');
    await bringUpOffIsland(page, { user: USER });
    await teleTo(page, USER, BANK_TELE);
    console.log(`runner '${USER}' at the Ardougne East bank`);

    await cheatQuiet(page, '~clearinv');
    await cheatQuiet(page, '~bankitem blankrune 52'); // 2 batches — withdraws as one note, un-notes 26 at a time
    await cheatQuiet(page, '~bankitem coins 100000');
    await page.waitForTimeout(800);

    // Runner mode, delivering to a (not-present) master — we only exercise bank + un-note.
    await page.evaluate(() => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', 'DummyMaster');
    });
    await startScript(page, 'NatureCrafter');
    console.log('runner started — watching bank restock + un-note');

    const deadline = Date.now() + budgetMin * 60_000;
    let seen = 0;
    let s = await sample(page);
    let withdrewNoted = false, withdrewUnnoted = false, ok = false;
    while (Date.now() < deadline) {
        s = await sample(page);
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s pos=${s.pos ? `${s.pos.x},${s.pos.z},${s.pos.level}` : '?'} noted=${s.noted} unnoted=${s.unnoted} coins=${s.coins} state=${s.state}`);
        for (let i = seen; i < s.logs.length; i++) {
            const m = s.logs[i];
            console.log(`      · ${m}`);
            if (/withdrew .* \(noted\)/.test(m)) { withdrewNoted = true; }
            if (/withdrew .* \(unnoted\)/.test(m)) { withdrewUnnoted = true; }
        }
        seen = s.logs.length;
        // Un-noted a deliverable batch on Karamja = bank note-withdraw + ship + Jiminua un-note all worked.
        if (s.unnoted >= 20) { ok = true; break; }
        if (s.state !== 'running') { break; }
        await page.waitForTimeout(2500);
    }

    if (ok) {
        const onKaramja = s.pos && s.pos.z < 3200;
        console.log(`PASS: runner un-noted ${s.unnoted} essence at Jiminua's store on Karamja (pos ${s.pos ? `${s.pos.x},${s.pos.z}` : '?'}, ${onKaramja ? 'shipped over OK' : 'position check'}), noteWithdraw=${withdrewNoted}, noted left=${s.noted}`);
        await browser.close();
        process.exit(0);
    }
    fail(`runner did not produce a deliverable unnoted stack within ${budgetMin}min [noted=${s.noted} unnoted=${s.unnoted} coins=${s.coins} state=${s.state} noteWithdraw=${withdrewNoted}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
