// Headless live smoke for the AIO questbot (AIOQuester): fresh account,
// mainland-ready (the only cheats — off-island tele + tutorial varp + relog),
// inject the quest queue, start the script, and watch it complete every picked
// quest for real — each quest's journal reaches 'complete', quest points tick
// up, and the runner stops itself once the queue is drained.
//
// This is the GENERIC quest runner every later quest task reuses: the quests
// come from argv (a CSV of quest ids, e.g. `runemysteries,doric`), so the same
// harness gates each new module as it lands. Passing just `runemysteries`
// reproduces the port-parity check (same quest, new engine) the standalone
// rune-mysteries-test.ts covers.
//
// Quest ids -> journal display names come straight from the bot's own quest
// table (F2P in src/bot/quests/data/f2p.ts, the same source AIOQuester's schema
// draws its option ids from), so the poll asks Quests.status() by the exact name
// the journal uses. Precedent for a tool importing a bot DATA module (not the
// browser-only runtime): tools/fisher-banking-test.ts imports FISHING_LOCATIONS.
//
// Settings are injected the way the ShopRunner/ShopBuyout smokes do it: raw
// `rs2b0t:set:<Script>:<key>` localStorage strings written AFTER the page is on
// the engine origin and BEFORE the script starts (see tools/shoprun-test.ts).
// A string[] setting is a comma-joined string; Settings.parseValue splits on
// ',' and trims, so the CSV goes straight through.
//
// Requires: engine on :8890 + local build deployed (deploy-local.sh).
// Budget default 25 min PER RUN (matches rune-mysteries-test's known-variance
// headroom; multi-quest queues should raise it). Does NOT run the queue live
// itself — deploy + live parity is the controller's job.
// Usage: bun tools/aio-quest-test.ts [base-url] [username] [quests-csv] [budget-min]

import { chromium } from 'playwright-core';
import { mainlandAccount, startScript } from './tutorial/harness.js';
import { F2P } from '../src/bot/quests/data/f2p.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `aq${Date.now().toString(36).slice(-7)}`;
// Default to the port-parity quest; empty arg falls back to it too (an empty
// AIOQuester queue would mean "every implemented quest", which is not what a
// smoke wants by default).
const questsCsv = (process.argv[4] || 'runemysteries').trim();
const budgetMin = Number(process.argv[5]) || 25;
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

// id -> journal display name, straight from the bot's F2P quest table so the
// poll matches Quests.status() on the exact string the journal renders.
const NAME_BY_ID = new Map(F2P.map(q => [q.id, q.name]));

// The queue we actually watch: each picked id resolved to its journal name.
// Unknown ids (not in F2P) fall back to the raw id so the run still starts and
// logs; they can never read 'complete', so the run will FAIL with a clear dump.
const picked = questsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0);
if (picked.length === 0) { fail('no quest ids given'); }
const queue = picked.map(id => {
    const name = NAME_BY_ID.get(id);
    if (!name) { console.log(`WARN: quest id '${id}' is not in F2P — polling by id, it will not complete`); }
    return { id, name: name ?? id };
});

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    statuses: Record<string, string>; // id -> journal status
    qp: number;
    runner: string;
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    // Inject the quest queue BEFORE start — raw rs2b0t:set:<Script>:<key> string,
    // the ShopRunner-smoke mechanism (tools/shoprun-test.ts). string[] settings
    // are comma-joined; Settings.parseValue splits on ',' so the CSV round-trips.
    await page.evaluate(csv => localStorage.setItem('rs2b0t:set:AIOQuester:quests', csv), questsCsv);
    console.log(`queued: ${queue.map(q => q.id).join(', ')}`);

    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');

    // Two page globals (per rune-mysteries-test): `__rs2b0t` is the script ABI
    // (Quests, reader); `rs2b0t` is the dev handle (runner state).
    const snap = (queueArg: { id: string; name: string }[]): Promise<Snapshot> =>
        page.evaluate(qq => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string } };
            };
            const statuses: Record<string, string> = {};
            for (const q of qq) { statuses[q.id] = g.__rs2b0t.Quests.status(q.name); }
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                statuses,
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state
            };
        }, queueArg);

    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    while (Date.now() < deadline) {
        last = await snap(queue);
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        const jrn = queue.map(q => `${q.id}=${last!.statuses[q.id]}`).join(' ');
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} ${jrn} qp=${last.qp} runner=${last.runner}`);
        const allDone = queue.every(q => last!.statuses[q.id] === 'complete');
        if (allDone && last.runner !== 'running') { break; }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    const incomplete = queue.filter(q => last!.statuses[q.id] !== 'complete');
    if (incomplete.length > 0) {
        const dump = queue.map(q => `${q.id}=${last!.statuses[q.id]}`).join(' ');
        fail(`quests not complete within ${budgetMin}min [${dump}] qp=${last.qp} runner=${last.runner}`);
    }
    if (last.qp < 1) { fail(`quest points ${last.qp}, expected >= 1`); }
    if (last.runner === 'running') { fail('script did not stop itself after the queue drained'); }
    console.log(`PASS (${queue.map(q => q.id).join(' -> ')} all journal complete, QP=${last.qp}, clean stop)`);
} finally {
    await browser.close();
}
