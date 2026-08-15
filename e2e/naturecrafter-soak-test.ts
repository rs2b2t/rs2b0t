// Soak: 1 master + N runners (default 8) for an hour, streaming a live dashboard and then asserting the fleet stayed healthy.
// Usage: bun e2e/naturecrafter-soak-test.ts [base] [budget-min] [num-runners] [rune: Air by default (the short Falador loop), "Nature runes" for the long Ardougne→Karamja route]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, positionalArgs, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const budgetMin = Number(args[1]) || 60;
const NUM_RUNNERS = Number(args[2]) || 8;
const RUNE = args[3] || 'Air runes';

interface RuneRoute {
    talisman: string;
    runeName: string;
    xpPerEssence: number;
    altarTele: string;
    bankTele: string;
    essencePer: number;
    coins: number; // 0 = the short route never spends any
    zones: { name: string; x: [number, number]; z: [number, number] }[];
}

const ROUTES: Record<string, RuneRoute> = {
    'Air runes': {
        talisman: 'air_talisman', runeName: 'air rune', xpPerEssence: 5,
        altarTele: '::tele 0,46,51,39,24', // air ruins (2983,3288)
        bankTele: '::tele 0,47,52,5,27', // Falador East (3013,3355)
        essencePer: 2500, coins: 0,
        zones: [
            { name: 'altar', x: [2965, 3005], z: [3270, 3305] },
            { name: 'fally', x: [2995, 3030], z: [3335, 3370] }
        ]
    },
    'Nature runes': {
        talisman: 'nature_talisman', runeName: 'nature rune', xpPerEssence: 9,
        altarTele: '::tele 0,44,47,49,14', // nature ruins (2865,3022)
        bankTele: '::tele 0,41,51,31,19', // Ardougne East (2655,3283)
        essencePer: 600, coins: 100_000,
        zones: [
            { name: 'ardy', x: [2600, 2690], z: [3260, 3345] },
            { name: 'store', x: [2755, 2780], z: [3110, 3135] },
            { name: 'altar', x: [2855, 2875], z: [3012, 3032] },
            { name: 'karamja', x: [2700, 2850], z: [3140, 3260] }
        ]
    }
};

const route = ROUTES[RUNE];
if (!route) { fail(`unknown rune '${RUNE}' — expected one of: ${Object.keys(ROUTES).join(', ')}`); }

const stamp = Date.now().toString(36).slice(-5);
const M_USER = `sokm${stamp}`;
const R_USERS = Array.from({ length: NUM_RUNNERS }, (_, i) => `sk${i}${stamp}`);
const MASTER_BANK_EVERY = '20'; // exercise the timed bank trip a few times inside the soak window

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; id: number; count: number }[] }; Skills: { xp(s: string): number }; reader: { worldTile(): { x: number; z: number; level: number } | null } };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

function zone(p: { x: number; z: number; level: number } | null): string {
    if (!p) { return '??'; }
    if (p.z > 4000) { return 'temple'; }
    const hit = route.zones.find(zn => p.x >= zn.x[0] && p.x <= zn.x[1] && p.z >= zn.z[0] && p.z <= zn.z[1]);
    return hit ? hit.name : `${p.x},${p.z}`;
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

function sample(page: Page): Promise<{ pos: { x: number; z: number; level: number } | null; runes: number; ess: number; coins: number; rcXp: number; state: string; lastLog: string; stopReason: string }> {
    return page.evaluate(rn => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const logs = g.rs2b0t.runner.ctx?.log ?? [];
        const msgs = logs.map(l => l.msg);
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            runes: items.filter(i => (i.name ?? '').toLowerCase() === rn).reduce((s, i) => s + Math.max(1, i.count), 0),
            ess: items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence').reduce((s, i) => s + Math.max(1, i.count), 0),
            coins: items.filter(i => (i.name ?? '').toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            lastLog: (msgs[msgs.length - 1] ?? '').slice(0, 46),
            stopReason: msgs.filter(m => /Stopping\.|stall guard|crashed/i.test(m)).slice(-1)[0] ?? ''
        };
    }, route.runeName);
}

const browser = await launchBrowser();
try {
    const ctxM = await browser.newContext();
    const pageM = await ctxM.newPage();
    const rPages: Page[] = [];
    for (let i = 0; i < NUM_RUNNERS; i++) { rPages.push(await (await browser.newContext()).newPage()); }

    console.log(`bringing up master + ${NUM_RUNNERS} runners for ${RUNE} (sequential — a few minutes)...`);
    await bringUp(pageM, M_USER);
    await teleTo(pageM, M_USER, route.altarTele);
    await cheatQuiet(pageM, '~maxme');
    await pageM.waitForTimeout(1500);
    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, `~item ${route.talisman} 1`);
    await pageM.evaluate(([names, rune, every]) => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:rune', rune);
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', names);
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:bankEvery', every);
    }, [R_USERS.join(','), RUNE, MASTER_BANK_EVERY]);
    console.log(`  master '${M_USER}' ready at the altar (banking everything every ${MASTER_BANK_EVERY}min)`);

    for (let i = 0; i < NUM_RUNNERS; i++) {
        await bringUp(rPages[i], R_USERS[i]);
        await teleTo(rPages[i], R_USERS[i], route.bankTele);
        await cheatQuiet(rPages[i], '~maxme');
        await rPages[i].waitForTimeout(1000);
        await cheatQuiet(rPages[i], '~clearinv');
        await cheatQuiet(rPages[i], `~bankitem blankrune ${route.essencePer}`);
        if (route.coins > 0) { await cheatQuiet(rPages[i], `~bankitem coins ${route.coins}`); }
        await rPages[i].evaluate(([m, rune]) => {
            sessionStorage.setItem('rs2b0t:set:NatureCrafter:rune', rune);
            sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
            sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', m);
        }, [M_USER, RUNE]);
        console.log(`  runner '${R_USERS[i]}' ready (${route.essencePer} essence banked${route.coins ? ` + ${route.coins} gp` : ', no coins — the short route needs none'})`);
    }

    await startScript(pageM, 'NatureCrafter');
    for (const p of rPages) { await startScript(p, 'NatureCrafter'); }
    console.log(`\nall started — soaking for ${budgetMin}min. dashboard every ~30s:\n`);

    const xp0 = (await sample(pageM)).rcXp;
    const startedAt = Date.now();
    const deadline = startedAt + budgetMin * 60_000;
    // a delivery is a runner's essence dropping to zero — no log parsing, no rolling-buffer misses
    const deliveries = new Array(NUM_RUNNERS).fill(0);
    const prevEss = new Array(NUM_RUNNERS).fill(0);
    const stoppedRunners = new Map<number, string>();
    let m = await sample(pageM);
    let masterBankTrips = 0;
    let sawMasterStop = '';

    while (Date.now() < deadline) {
        const [mm, ...rr] = await Promise.all([sample(pageM), ...rPages.map(sample)]);
        m = mm;
        const mins = Math.round((Date.now() - startedAt) / 6000) / 10;
        const craftedEss = Math.round((m.rcXp - xp0) / route.xpPerEssence);
        const inFlight = rr.reduce((s, r) => s + r.ess, 0);
        if (/min bank trip/.test(m.lastLog)) { masterBankTrips++; }
        if (m.state !== 'running' && !sawMasterStop) { sawMasterStop = m.stopReason || m.state; }

        rr.forEach((r, i) => {
            if (prevEss[i] > 0 && r.ess === 0) { deliveries[i]++; }
            prevEss[i] = r.ess;
            if (r.state !== 'running' && !stoppedRunners.has(i)) { stoppedRunners.set(i, r.stopReason || r.state); }
        });

        const rate = Math.round(craftedEss / Math.max(0.1, (Date.now() - startedAt) / 3_600_000));
        console.log(`── t=${mins}min | master ${m.runes} ${route.runeName}s · ${craftedEss} ess crafted (+${m.rcXp - xp0} xp, ~${rate} ess/hr) @${zone(m.pos)} ${m.state} | ${inFlight} ess in runner packs | deliveries ${deliveries.reduce((a, b) => a + b, 0)}`);
        rr.forEach((r, i) => {
            console.log(`   R${i} ${zone(r.pos).padEnd(9)} ess=${String(r.ess).padStart(3)} gp=${String(r.coins).padStart(6)} deliv=${String(deliveries[i]).padStart(3)} ${r.state.padEnd(8)} · ${r.lastLog}`);
        });

        if (m.state === 'crashed' || rr.some(r => r.state === 'crashed')) {
            console.log('!! a bot crashed — ending the soak early');
            break;
        }
        await pageM.waitForTimeout(30_000);
    }

    const craftedEss = Math.round((m.rcXp - xp0) / route.xpPerEssence);
    const elapsedMin = Math.round((Date.now() - startedAt) / 6000) / 10;
    const totalDeliveries = deliveries.reduce((a, b) => a + b, 0);
    const idle = deliveries.map((d, i) => ({ d, i })).filter(x => x.d === 0).map(x => `R${x.i}`);

    console.log(`\n=== SOAK DONE (${elapsedMin}min, ${NUM_RUNNERS} runners, ${RUNE}) ===`);
    console.log(`master crafted ${craftedEss} essence (${m.runes} ${route.runeName}s, +${m.rcXp - xp0} rc xp) — ~${Math.round(craftedEss / Math.max(0.1, elapsedMin / 60))} essence/hr`);
    console.log(`deliveries per runner: ${deliveries.join(', ')} (total ${totalDeliveries})`);
    console.log(`master bank trips seen: ${masterBankTrips}`);
    if (stoppedRunners.size > 0) {
        for (const [i, why] of stoppedRunners) { console.log(`   R${i} stopped: ${why}`); }
    }

    const problems: string[] = [];
    if (sawMasterStop) { problems.push(`master stopped mid-soak: ${sawMasterStop}`); }
    if (stoppedRunners.size > 0) { problems.push(`${stoppedRunners.size} runner(s) stopped: ${[...stoppedRunners.entries()].map(([i, w]) => `R${i} (${w})`).join('; ')}`); }
    if (idle.length > 0) { problems.push(`${idle.join(', ')} never delivered — wedged or starved`); }
    if (craftedEss === 0) { problems.push('master crafted nothing'); }

    if (problems.length === 0) {
        console.log(`\nPASS: ${NUM_RUNNERS} runners fed the master for ${elapsedMin}min with no stops, no crashes and every runner delivering.`);
        await browser.close();
        process.exit(0);
    }
    fail(`soak found ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
