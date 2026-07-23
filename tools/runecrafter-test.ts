// Live smoke for RuneCrafter (Air). Mainland account -> seed bank with rune
// essence + an air talisman -> run RuneCrafter -> watch it bank, walk to the
// Mysterious ruins south of Falador, use the talisman to enter the altar,
// craft-rune, portal back, and bank. PASS when it crafts Air runes (runecraft
// XP gained + Air rune in the pack).
//
// Usage: bun tools/runecrafter-test.ts [base] [user] [budget-min]

import { launchBrowser } from './lib/harness.js';
import { cheat, mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `rc${Date.now().toString(36).slice(-6)}`;
const budgetMin = Number(process.argv[4]) || 30;
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type R = {
    __rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        Inventory: { items(): { name: string | null; count: number }[] };
        Skills: { level(n: string): number; xp(n: string): number };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => { const t = m.text(); if (t.startsWith('[bot]')) { console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${t}`); } });

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    // Seed AFTER mainlandAccount's relog (a pre-relog seed is rolled back).
    await cheat(page, '~bankitem blankrune 200');
    await cheat(page, '~bankitem air_talisman 1');
    console.log('seeded bank: 200 Rune essence + 1 Air talisman — walks from the spawn');

    await page.evaluate(() => localStorage.setItem('rs2b0t:set:RuneCrafter:rune', 'Air runes'));
    await startScript(page, 'RuneCrafter');
    console.log('started RuneCrafter (Air) — watching for crafted Air runes');

    const snap = () => page.evaluate(() => {
        const g = globalThis as never as R;
        const items = g.__rs2b0t.Inventory.items();
        const count = (n: string) => items.filter(i => (i.name ?? '').toLowerCase() === n).reduce((s, i) => s + Math.max(1, i.count), 0);
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            rcLvl: g.__rs2b0t.Skills.level('runecraft'),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            airRunes: count('air rune'),
            essence: count('rune essence'),
            talisman: count('air talisman'),
            runner: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-40).map(l => l.msg)
        };
    });

    const xp0 = (await snap()).rcXp;
    const deadline = Date.now() + BUDGET_MS;
    let seenLog = 0;
    let last = await snap();
    let enteredTemple = false, craftedRunes = false, exited = false;
    while (Date.now() < deadline) {
        last = await snap();
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} rc=${last.rcLvl}(+${last.rcXp - xp0}xp) airRunes=${last.airRunes} ess=${last.essence} tal=${last.talisman} runner=${last.runner}`);
        for (let i = seenLog; i < last.logs.length; i++) { console.log(`      · ${last.logs[i]}`); }
        seenLog = last.logs.length;
        if (last.pos && last.pos.z > 4000) { enteredTemple = true; }               // in a temple
        if (last.rcXp > xp0 && last.airRunes > 0) { craftedRunes = true; }
        if (enteredTemple && craftedRunes && last.pos && last.pos.z < 4000) { exited = true; break; } // portalled back out
        if (last.runner !== 'running') { break; }
        await page.waitForTimeout(5_000);
    }

    if (craftedRunes && exited) {
        console.log(`PASS: crafted ${last.airRunes} Air runes (runecraft +${last.rcXp - xp0} xp) and portalled back out to z=${last.pos?.z}, talisman kept=${last.talisman}`);
        await browser.close();
        process.exit(0);
    }
    fail(`did not craft + exit within ${budgetMin}min [entered=${enteredTemple} crafted=${craftedRunes} exited=${exited} airRunes=${last.airRunes} rcXp+${last.rcXp - xp0} z=${last.pos?.z} runner=${last.runner}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
