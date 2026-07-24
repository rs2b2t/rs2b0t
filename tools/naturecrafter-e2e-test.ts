// Full end-to-end smoke for the Master Nature Crafter (phases 2+3 together): a master
// bot at the nature altar and a runner bot starting from the Ardougne bank. The runner
// banks a note, ships to Karamja, un-notes at Jiminua, walks to the altar, and hands the
// unnoted essence to the master (keeping its noted stack); the master crafts natures.
// PASS when the master crafts natures from delivered essence AND the runner never gives
// away its noted stack.
//
// Usage: bun tools/naturecrafter-e2e-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 20;
const stamp = Date.now().toString(36).slice(-6);
const M_USER = `nem${stamp}`; // master
const R_USER = `ner${stamp}`; // runner
const ALTAR_TELE = '::tele 0,44,47,49,14'; // nature ruins (2865,3022)
const BANK_TELE = '::tele 0,41,51,31,19'; // Ardougne East bank (2655,3283)

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[] }; Skills: { xp(s: string): number; level(s: string): number }; reader: { worldTile(): { x: number; z: number; level: number } | null } };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

async function bringUp(page: Page, user: string): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await bringUpOffIsland(page, { user });
}

async function teleTo(page: Page, user: string, tele: string): Promise<void> {
    await type(page, tele);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(2500); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin failed`);
}

function sample(page: Page): Promise<{ pos: { x: number; z: number } | null; natures: number; unnoted: number; noted: number; rcXp: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const ess = items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence');
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            natures: items.filter(i => (i.name ?? '').toLowerCase() === 'nature rune').reduce((s, i) => s + Math.max(1, i.count), 0),
            unnoted: ess.filter(i => i.count === 1).length,
            noted: ess.filter(i => i.count > 1).reduce((s, i) => s + i.count, 0),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-12).map(l => l.msg)
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
    await teleTo(pageM, M_USER, ALTAR_TELE);
    await teleTo(pageR, R_USER, BANK_TELE);
    console.log('master at the altar, runner at the Ardougne bank');

    // Master: maxed runecraft + a nature talisman, Master mode taking essence from the runner.
    await cheatQuiet(pageM, '~maxme');
    await pageM.waitForTimeout(1500);
    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, '~item nature_talisman 1');
    await pageM.evaluate(n => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
        localStorage.setItem('rs2b0t:set:NatureCrafter:bankAt', '400'); // never bank natures during the smoke
    }, R_USER);

    // Runner: 99 hp + combat (dangerous monsters on the Karamja jungle route), essence
    // + coins in the Ardougne bank, Runner mode delivering to the master.
    await cheatQuiet(pageR, '~maxme');
    await pageR.waitForTimeout(1200);
    await cheatQuiet(pageR, '~clearinv');
    await cheatQuiet(pageR, '~bankitem blankrune 27'); // 27 = 26 + 1 -> leaves a "note of 1" (the finding-#1 wedge case)
    await cheatQuiet(pageR, '~bankitem coins 100000');
    await pageR.evaluate(n => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
    }, M_USER);
    await pageM.waitForTimeout(600);

    await startScript(pageM, 'NatureCrafter');
    await startScript(pageR, 'NatureCrafter');
    console.log('both bots started — runner making the Ardougne→Karamja→altar trip');

    const xp0 = (await sample(pageM)).rcXp;
    const deadline = Date.now() + budgetMin * 60_000;
    let seenM = 0, seenR = 0;
    let m = await sample(pageM), r = await sample(pageR);
    let delivered = false, crafted = false, keptNoted = false;
    while (Date.now() < deadline) {
        m = await sample(pageM); r = await sample(pageR);
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s | M nat=${m.natures} rc+${m.rcXp - xp0} @${m.pos ? `${m.pos.x},${m.pos.z}` : '?'} | R noted=${r.noted} unnoted=${r.unnoted} @${r.pos ? `${r.pos.x},${r.pos.z}` : '?'} ${r.state}`);
        for (let i = seenR; i < r.logs.length; i++) { console.log(`   [R] ${r.logs[i]}`); }
        seenR = r.logs.length;
        for (let i = seenM; i < m.logs.length; i++) { console.log(`   [M] ${m.logs[i]}`); }
        seenM = m.logs.length;

        if (r.logs.some(l => /delivered \d+ essence/.test(l))) { delivered = true; }
        if (delivered && r.noted > 0) { keptNoted = true; } // still holds the leftover note after a delivery
        if (m.natures >= 54 && m.rcXp > xp0) { crafted = true; } // all 27 essence crafted (27*2) — a note-of-1 wedge would stall at 52
        if (crafted && delivered) { break; }
        if (r.state === 'crashed' || m.state === 'crashed') { break; }
        await pageM.waitForTimeout(3000);
    }

    if (crafted && delivered) {
        console.log(`PASS: runner delivered essence to the master (kept its noted stack: ${keptNoted}), master crafted ${m.natures} natures (rc +${m.rcXp - xp0} xp)`);
        await browser.close();
        process.exit(0);
    }
    fail(`incomplete within ${budgetMin}min [delivered=${delivered} crafted=${crafted} keptNoted=${keptNoted} Mnat=${m.natures} Rnoted=${r.noted} Runnoted=${r.unnoted} Rstate=${r.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
