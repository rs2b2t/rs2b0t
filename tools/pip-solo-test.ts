// Fast iteration harness for Priest in Peril ALONE: skips the ~20-min Rune
// Mysteries prefix by pre-setting the server varp runemysteries=6 (complete) —
// that's the ONLY dependency (Aubury's essence-mine teleport is gated on it),
// and PiP itself has no quest gate (F2P can start it). Everything else mirrors
// tools/aio-quest-test.ts: mainland account, inject queue=priestperil, start,
// poll the priestperil journal until complete or budget.
//
// Usage: bun tools/pip-solo-test.ts [base] [user] [budget-min] [give-csv] [stats-csv] [food] [pip-stage]
//   NOT the acceptance run — that is aio-quest-test.ts with runemysteries,priestperil
//   run uncheated. This exists only to iterate on PiP legs quickly.
//   pip-stage: optional priestperil varp to jump to (e.g. 5 = find_drezel_key,
//     6 = unlocked, 8 = meet_in_mausoleum) + tele to the temple + relog, so a
//     mid/late-game leg can be exercised without replaying the ~15-min early game.
//     Use the give-csv to hand the pack items that stage implies (e.g. bucket_empty:1).

import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `ps${Date.now().toString(36).slice(-7)}`;
const budgetMin = Number(process.argv[4]) || 30;
const giveCsv = (process.argv[5] || '').trim();
const statsCsv = (process.argv[6] || '').trim();
const foodSetting = (process.argv[7] || '').trim();
const pipStage = (process.argv[8] || '').trim();
const BUDGET_MS = budgetMin * 60_000;
const QUEST_NAME = 'Priest in Peril';

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) { console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`); }
    });

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    // Pre-complete Rune Mysteries (server gate for Aubury's essence teleport).
    // cheatQuiet (NOT cheat): after mainlandAccount's setvar tutorial, the typed
    // `cheat` path's focus is eaten and the command is silently dropped (harness
    // note) — the swallowed setvar left RM incomplete and Aubury refused the
    // teleport (live pspip6b). cheatQuiet writes the CLIENT_CHEAT packet directly.
    await cheatQuiet(page, 'setvar runemysteries 6');
    await relog(page, username);
    const rm = await getServerVarQuiet(page, 'runemysteries');
    console.log(`set runemysteries=${rm} (essence-mine teleport gate)`);

    // Optional mid/late-game jump: set the priestperil varp + tele to the temple
    // exterior + relog (headless ::tele leaves the scene un-rebuilt — relog
    // rebuilds it). The give-csv supplies the pack items that stage implies.
    if (pipStage) {
        await cheatQuiet(page, `setvar priestperil ${pipStage}`);
        await cheatQuiet(page, 'tele 3406 3488 0');
        await relog(page, username);
        const pp = await getServerVarQuiet(page, 'priestperil');
        console.log(`jumped priestperil=${pp} + tele temple exterior`);
    }

    for (const pair of giveCsv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `~item ${obj} ${Number(n) || 1}`))) { fail(`give '${pair}' not sent`); }
        console.log(`gave ${pair}`);
    }
    for (const pair of statsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [stat, lvl] = pair.split(':');
        if (!(await cheatQuiet(page, `advancestat ${stat} ${Number(lvl) || 1}`))) { fail(`advancestat '${pair}' not sent`); }
        console.log(`advanced ${pair}`);
    }

    await page.evaluate(() => localStorage.setItem('rs2b0t:set:AIOQuester:quests', 'priestperil'));
    if (foodSetting) { await page.evaluate(f => localStorage.setItem('rs2b0t:set:AIOQuester:food', f), foodSetting); }
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching priestperil');

    const snap = (): Promise<Snapshot> => page.evaluate(name => {
        const g = globalThis as never as {
            __rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null }; Quests: { status(n: string): string; points(): number } };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(name),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-60).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST_NAME);

    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    let lastLogTime = 0;
    while (Date.now() < deadline) {
        last = await snap();
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} priestperil=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const l of last.logs) { if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); } }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }
        if (last.status === 'complete' && last.runner !== 'running') { break; }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    if (last.status !== 'complete') { fail(`priestperil not complete within ${budgetMin}min [status=${last.status}] qp=${last.qp} runner=${last.runner}`); }
    console.log(`PASS (priestperil journal complete, QP=${last.qp})`);
} finally {
    await browser.close();
}
