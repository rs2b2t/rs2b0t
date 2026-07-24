// Soak test for the Master Nature Crafter: 1 master at the nature altar + N runners
// (default 8), each seeded with 300 noted essence + 100k gp in the Ardougne bank. Starts
// everyone and streams a live dashboard so you can watch throughput, contention at the
// master, and whether any runner gets stuck. Runs until the budget or every runner is dry.
//
// Usage: bun tools/naturecrafter-soak-test.ts [base] [budget-min] [num-runners]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 45;
const NUM_RUNNERS = Number(process.argv[4]) || 8;
const ESSENCE_PER = 300;
const stamp = Date.now().toString(36).slice(-5);
const M_USER = `sokm${stamp}`;
const R_USERS = Array.from({ length: NUM_RUNNERS }, (_, i) => `sk${i}${stamp}`);
const ALTAR_TELE = '::tele 0,44,47,49,14'; // nature ruins (2865,3022)
const BANK_TELE = '::tele 0,41,51,31,19'; // Ardougne East bank (2655,3283)

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[] }; Skills: { xp(s: string): number }; reader: { worldTile(): { x: number; z: number; level: number } | null } };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

function zone(p: { x: number; z: number; level: number } | null): string {
    if (!p) { return '??'; }
    if (p.z > 4000) { return 'temple'; }
    if (p.x >= 2600 && p.x <= 2690 && p.z >= 3260 && p.z <= 3345) { return 'ardy'; }
    if (p.x >= 2755 && p.x <= 2780 && p.z >= 3110 && p.z <= 3135) { return 'store'; }
    if (p.x >= 2855 && p.x <= 2875 && p.z >= 3012 && p.z <= 3032) { return 'altar'; }
    if (p.z >= 3140 && p.z <= 3260 && p.x >= 2700) { return 'karamja'; }
    return `${p.x},${p.z}`;
}

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

function sample(page: Page): Promise<{ pos: { x: number; z: number; level: number } | null; natures: number; noted: number; unnoted: number; coins: number; rcXp: number; state: string; lastLog: string }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const ess = items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence');
        const logs = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            natures: items.filter(i => (i.name ?? '').toLowerCase() === 'nature rune').reduce((s, i) => s + Math.max(1, i.count), 0),
            noted: ess.filter(i => i.count > 1).reduce((s, i) => s + i.count, 0),
            unnoted: ess.filter(i => i.count === 1).length,
            coins: items.filter(i => (i.name ?? '').toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            lastLog: (logs[logs.length - 1]?.msg ?? '').slice(0, 48)
        };
    });
}

const browser = await launchBrowser();
try {
    const ctxM = await browser.newContext();
    const pageM = await ctxM.newPage();
    const rPages: Page[] = [];
    for (let i = 0; i < NUM_RUNNERS; i++) { rPages.push(await (await browser.newContext()).newPage()); }

    console.log(`bringing up master + ${NUM_RUNNERS} runners (sequential — a few minutes)...`);
    await bringUp(pageM, M_USER);
    await teleTo(pageM, M_USER, ALTAR_TELE);
    await cheatQuiet(pageM, '~maxme');
    await pageM.waitForTimeout(1500);
    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, '~item nature_talisman 1');
    await pageM.evaluate(names => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', names);
        localStorage.setItem('rs2b0t:set:NatureCrafter:bankAt', '0'); // never bank — hold the stacking natures (default now)
    }, R_USERS.join(','));
    console.log(`  master '${M_USER}' ready at the altar`);

    for (let i = 0; i < NUM_RUNNERS; i++) {
        await bringUp(rPages[i], R_USERS[i]);
        await teleTo(rPages[i], R_USERS[i], BANK_TELE);
        await cheatQuiet(rPages[i], '~maxme');
        await rPages[i].waitForTimeout(1000);
        await cheatQuiet(rPages[i], '~clearinv');
        await cheatQuiet(rPages[i], `~bankitem blankrune ${ESSENCE_PER}`);
        await cheatQuiet(rPages[i], '~bankitem coins 100000');
        await rPages[i].evaluate(m => {
            localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
            localStorage.setItem('rs2b0t:set:NatureCrafter:partner', m);
        }, M_USER);
        console.log(`  runner '${R_USERS[i]}' ready at the Ardougne bank (${ESSENCE_PER} essence + 100k gp)`);
    }

    await startScript(pageM, 'NatureCrafter');
    for (const p of rPages) { await startScript(p, 'NatureCrafter'); }
    console.log(`\nall started — soaking for up to ${budgetMin}min. dashboard every ~20s:\n`);

    const xp0 = (await sample(pageM)).rcXp;
    const deadline = Date.now() + budgetMin * 60_000;
    let ticks = 0;
    let m = await sample(pageM);
    while (Date.now() < deadline) {
        const [mm, ...rr] = await Promise.all([sample(pageM), ...rPages.map(sample)]);
        m = mm;
        ticks++;
        const mins = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 60_000 * 10) / 10;
        const inFlight = rr.reduce((s, r) => s + r.noted + r.unnoted, 0); // essence in runners' packs (bank not visible)
        const craftedEss = Math.round((m.rcXp - xp0) / 9); // nature = 9 rc xp / essence
        const anyCrashed = mm.state === 'crashed' || rr.some(r => r.state === 'crashed');
        console.log(`── t=${mins}min | master: ${m.natures} natures (${craftedEss} essence crafted, +${m.rcXp - xp0} rc xp) @${zone(m.pos)} | ${inFlight} essence in runner packs`);
        rr.forEach((r, i) => {
            console.log(`   R${i} ${zone(r.pos).padEnd(8)} ess=${(r.noted + r.unnoted).toString().padStart(3)} (n${r.noted}/u${r.unnoted}) gp=${r.coins.toString().padStart(6)} ${r.state.padEnd(8)} · ${r.lastLog}`);
        });
        if (anyCrashed) { console.log('!! a bot crashed — stopping'); break; }
        await pageM.waitForTimeout(20_000);
    }

    const craftedEss = Math.round((m.rcXp - xp0) / 9);
    console.log(`\n=== SOAK DONE === master crafted ${m.natures} natures (~${craftedEss} essence) across ${NUM_RUNNERS} runners over ${budgetMin}min budget.`);
    // Not a pass/fail smoke — this is an observation run. Leave the browser open for a look.
    console.log('(browser left open — Ctrl-C to close)');
    await new Promise(() => {});
} catch (e) {
    console.error(e);
    fail(String(e));
}
