// Live smoke for the NatureCrafter master (Master Nature Crafter, phase 2).
// Two mainland accounts at the nature Mysterious ruins (Karamja): M runs the
// NatureCrafter master bot; R is a scripted runner that trades essence to M. PASS
// when the master takes R's essence, enters the altar, and crafts Nature runes.
//
// Usage: bun tools/naturecrafter-master-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 8;
const stamp = Date.now().toString(36).slice(-6);
const M_USER = `natm${stamp}`; // master
const R_USER = `natr${stamp}`; // runner
const ITEM = 'Rune essence';
const SEED = 26; // fits the runner pack + leaves the master room (talisman + 26 = 27)
const ALTAR_TELE = '::tele 0,44,47,49,14'; // (2865,3022) nature ruins / trade spot

type Abi = {
    __rs2b0t: {
        Trade: { request(n: string): Promise<boolean>; offerAll(n: string): Promise<boolean>; accept(): Promise<boolean>; active(): boolean; onOfferScreen(): boolean };
        Inventory: { count(n: string): number };
        Skills: { level(s: string): number; xp(s: string): number };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

const tActive = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active());
const tOnOffer = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onOfferScreen());
const tRequest = (p: Page, n: string) => p.evaluate(x => (globalThis as never as Abi).__rs2b0t.Trade.request(x), n);
const tOfferAll = (p: Page, n: string) => p.evaluate(x => (globalThis as never as Abi).__rs2b0t.Trade.offerAll(x), n);
const tAccept = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.accept());
const count = (p: Page, n: string) => p.evaluate(x => (globalThis as never as Abi).__rs2b0t.Inventory.count(x), n);

async function bringUp(page: Page, user: string): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await bringUpOffIsland(page, { user });
}

async function teleToAltar(page: Page, user: string): Promise<void> {
    await type(page, ALTAR_TELE);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(3000); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin at the altar failed`);
    console.log(`[${user}] at the nature ruins`);
}

function sampleMaster(page: Page): Promise<{ pos: { x: number; z: number; level: number } | null; rcXp: number; rcLvl: number; essence: number; natures: number; talisman: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = (g.__rs2b0t as never as { Inventory: { items(): { name: string | null; count: number }[] } }).Inventory.items();
        const c = (n: string) => items.filter(i => (i.name ?? '').toLowerCase() === n).reduce((s, i) => s + Math.max(1, i.count), 0);
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            rcLvl: g.__rs2b0t.Skills.level('runecraft'),
            essence: c('rune essence'),
            natures: c('nature rune'),
            talisman: c('nature talisman'),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-30).map(l => l.msg)
        };
    });
}

const browser = await launchBrowser();
try {
    const ctxM = await browser.newContext();
    const ctxR = await browser.newContext();
    const pageM = await ctxM.newPage();
    const pageR = await ctxR.newPage();

    await bringUp(pageM, M_USER);
    await bringUp(pageR, R_USER);
    await teleToAltar(pageM, M_USER);
    await teleToAltar(pageR, R_USER);

    // Master: max stats (runecraft 44+), clean pack + a nature talisman.
    await cheatQuiet(pageM, '~maxme');
    await pageM.waitForTimeout(1500);
    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, '~item nature_talisman 1');
    // Runner: clean pack + a batch of essence to deliver.
    await cheatQuiet(pageR, '~clearinv');
    await cheatQuiet(pageR, `~item blankrune ${SEED}`);
    await pageM.waitForTimeout(800);

    const mRc = await pageM.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.level('runecraft'));
    const rEss = await count(pageR, ITEM);
    const mTal = await count(pageM, 'Nature talisman');
    if (mRc < 44) fail(`master runecraft ${mRc} < 44 after maxme`);
    if (mTal < 1) fail('master has no nature talisman');
    if (rEss < SEED) fail(`runner holds ${rEss} essence, expected ${SEED}`);
    console.log(`seeded: master rc=${mRc} talisman=${mTal}, runner essence=${rEss}`);

    // Configure + start the master bot. bankAt high so it won't try the quest-gated Shilo bank.
    await pageM.evaluate(n => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
        localStorage.setItem('rs2b0t:set:NatureCrafter:bankAt', '50');
    }, R_USER);
    await startScript(pageM, 'NatureCrafter');
    console.log('master bot started — watching for a completed trade + crafted natures');

    const xp0 = (await sampleMaster(pageM)).rcXp;
    const deadline = Date.now() + budgetMin * 60_000;
    let seen = 0;
    let crafted = false;
    let m = await sampleMaster(pageM);
    while (Date.now() < deadline) {
        m = await sampleMaster(pageM);
        // Drive the runner side until the master actually RECEIVES essence (not merely
        // until it leaves the runner's pack — offered essence reads as 0 in the pack but
        // the trade isn't done). Keep accepting through both offer + confirm screens.
        if (m.essence === 0 && m.natures === 0) {
            if (await tActive(pageR)) {
                if (await tOnOffer(pageR)) { await tOfferAll(pageR, ITEM); }
                await tAccept(pageR);
            } else if ((await count(pageR, ITEM)) > 0) {
                await tRequest(pageR, M_USER);
            }
        }

        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s master pos=${m.pos ? `${m.pos.x},${m.pos.z},${m.pos.level}` : '?'} ess=${m.essence} nat=${m.natures} rc=${m.rcLvl}(+${m.rcXp - xp0}) runnerEss=${await count(pageR, ITEM)} state=${m.state}`);
        for (let i = seen; i < m.logs.length; i++) { console.log(`      · ${m.logs[i]}`); }
        seen = m.logs.length;

        if (m.natures >= 20 && m.rcXp > xp0) { crafted = true; break; }
        if (m.state !== 'running') { break; }
        await pageM.waitForTimeout(2500);
    }

    if (crafted) {
        console.log(`PASS: master took the runner's essence and crafted ${m.natures} Nature runes (runecraft +${m.rcXp - xp0} xp)`);
        await browser.close();
        process.exit(0);
    }
    fail(`master did not craft natures within ${budgetMin}min [ess=${m.essence} nat=${m.natures} rcXp+${m.rcXp - xp0} state=${m.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
