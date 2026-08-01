/**
 * Live AIOQuester harness against a local engine.
 *
 * Usage:
 *   HEADED=1 bun tools/aio-quest-test.ts \
 *     [base] [user] [questsCsv] [minutes] [giveCsv] [statsCsv] [food] [cheatsCsv] [tele]
 *
 * giveCsv   — debug names via real `give` procs: knife:1,hammer:1  (NOT ~item — silent no-op)
 * statsCsv  — `max` for ~maxme+dialog drain, or advancestat pairs mining:99,smithing:99
 * cheatsCsv — raw debugprocs before stats (e.g. ~bank_f2p,speed 300). Do not put ~maxme here;
 *             use statsCsv=max so dialogs are cleared before tele/start.
 * tele      — world tile `x,z` or `x,z,level`, or engine tele `level,mx,mz,lx,lz`
 *
 * Elemental Workshop example (Seers bookcase, maxed, tools in inv, 2× ticks):
 *   HEADED=1 bun tools/aio-quest-test.ts http://localhost:8890 ew1 elemental_workshop 20 \
 *     'knife:1,hammer:1,bronze_pickaxe:1,thread:1,leather:1,needle:1,coal:4,lobster:15' \
 *     max Lobster '~bank_f2p,speed 300' '2716,3481'
 */
import type { Page } from 'playwright-core';
import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    mainlandAccount,
    maxmeAndClearDialogs,
    startScript,
    teleCheat,
    teleTo
} from './tutorial/harness.js';
import { QUESTS } from '../src/bot/quests/data/quests.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `aq${Date.now().toString(36).slice(-7)}`;
const questsCsv = (process.argv[4] || 'runemysteries').trim();
const budgetMin = Number(process.argv[5]) || 25;
const giveCsv = (process.argv[6] || '').trim();
const statsCsv = (process.argv[7] || '').trim();
const foodSetting = (process.argv[8] || '').trim();
/** Raw debugprocs (not ~maxme — use statsCsv=max). e.g. `~bank_f2p,speed 300`. */
const cheatsCsv = (process.argv[9] || '').trim();
/** World `x,z[,level]` or engine `level,mx,mz,lx,lz`. */
const teleArg = (process.argv[10] || '').trim();
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

const NAME_BY_ID = new Map(QUESTS.map(q => [q.id, q.name]));

const picked = questsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0);
if (picked.length === 0) { fail('no quest ids given'); }
const queue = picked.map(id => {
    const name = NAME_BY_ID.get(id);
    if (!name) { console.log(`WARN: quest id '${id}' is not in QUESTS — polling by id, it will not complete`); }
    return { id, name: name ?? id };
});

type Snapshot = {
    pos: { x: number; z: number; level: number } | null;
    statuses: Record<string, string>;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
};

/** Parse tele arg into a world tile (for wait) + engine cheat string. */
function parseTele(arg: string): { tile: { x: number; z: number; level: number }; cheat: string } | null {
    if (!arg) {
        return null;
    }
    const parts = arg.split(',').map(s => Number(s.trim()));
    if (parts.some(n => !Number.isFinite(n))) {
        return null;
    }
    if (parts.length === 2 || parts.length === 3) {
        const tile = { x: parts[0]!, z: parts[1]!, level: parts[2] ?? 0 };
        return { tile, cheat: teleCheat(tile) };
    }
    if (parts.length === 5) {
        const [level, mx, mz, lx, lz] = parts as [number, number, number, number, number];
        const tile = { x: mx * 64 + lx, z: mz * 64 + lz, level };
        return { tile, cheat: `tele ${level},${mx},${mz},${lx},${lz}` };
    }
    return null;
}

async function seedGives(page: Page, csv: string): Promise<void> {
    for (const pair of csv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [obj, n] = pair.split(':');
        if (!obj) {
            continue;
        }
        // Real debugproc is `give`, not `~item` (silent no-op — see #276).
        const cmd = `give ${obj} ${Number(n) || 1}`;
        if (!(await cheatQuiet(page, cmd))) {
            fail(`account prep '${cmd}' not sent (not ingame?)`);
        }
        console.log(`gave ${pair}`);
    }
}

async function seedStats(page: Page, csv: string): Promise<void> {
    if (!csv) {
        return;
    }
    if (csv.toLowerCase() === 'max') {
        console.log('maxme + clear level-up dialogs');
        await maxmeAndClearDialogs(page);
        return;
    }
    let advanced = false;
    for (const pair of csv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [stat, lvl] = pair.split(':');
        if (!(await cheatQuiet(page, `advancestat ${stat} ${Number(lvl) || 1}`))) {
            fail(`account prep 'advancestat ${pair}' not sent (not ingame?)`);
        }
        console.log(`advanced ${pair}`);
        advanced = true;
    }
    if (advanced) {
        await clearChatDialogs(page, 'level-up dialog(s)');
        await page.waitForTimeout(1500);
        await clearChatDialogs(page, 'straggler dialog(s)');
    }
}

const tele = parseTele(teleArg);
if (teleArg && !tele) {
    fail(`bad tele '${teleArg}' — use x,z[,level] or level,mx,mz,lx,lz`);
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, base, username);
    console.log(`mainland-ready as '${username}'`);

    // Non-maxme cheats first (bank stock, speed, etc.). ~maxme goes through statsCsv=max.
    for (const command of cheatsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        if (command === '~maxme' || command === 'maxme') {
            console.log(`cheat: ${command} (deferred — use statsCsv=max for dialog drain)`);
            continue;
        }
        if (command.startsWith('tele ')) {
            console.log(`cheat: ${command} (deferred — use tele arg so it runs after dialogs)`);
            continue;
        }
        if (!(await cheatQuiet(page, command))) {
            fail(`account prep '${command}' not sent (not ingame?)`);
        }
        console.log(`cheat: ${command}`);
    }

    await seedGives(page, giveCsv);
    await seedStats(page, statsCsv);

    // If cheats asked for maxme without statsCsv=max, still drain (best effort).
    if (/(^|,)\s*~?maxme\s*(,|$)/i.test(cheatsCsv) && statsCsv.toLowerCase() !== 'max') {
        console.log('maxme from cheatsCsv — clearing dialogs');
        await cheatQuiet(page, '~maxme');
        await clearChatDialogs(page, 'level-up dialog(s)');
        await page.waitForTimeout(1500);
        await clearChatDialogs(page, 'straggler dialog(s)');
    }

    if (tele) {
        console.log(`tele → ${tele.tile.x},${tele.tile.z},${tele.tile.level}`);
        if (!(await teleTo(page, tele.tile, 10, 25_000))) {
            // One hard retry after another dialog drain (straggler level-ups block p_finduid).
            await clearChatDialogs(page, 'pre-tele dialog(s)');
            if (!(await teleTo(page, tele.tile, 10, 25_000))) {
                fail(`tele to ${tele.tile.x},${tele.tile.z} did not arrive`);
            }
        }
        // Scene rebuild lag after tele — give locs a moment before the script acts.
        await page.waitForTimeout(1500);
    }

    await page.evaluate(csv => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', csv), questsCsv);
    if (foodSetting) {
        await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), foodSetting);
        console.log(`food setting: ${foodSetting}`);
    }
    console.log(`queued: ${queue.map(q => q.id).join(', ')}`);

    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');

    const snap = (queueArg: { id: string; name: string }[]): Promise<Snapshot> =>
        page.evaluate(qq => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            const statuses: Record<string, string> = {};
            for (const q of qq) { statuses[q.id] = g.__rs2b0t.Quests.status(q.name); }
            const ring = g.rs2b0t.runner.ctx?.log ?? [];
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                statuses,
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: ring.slice(-60).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
            };
        }, queueArg);

    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    let lastLogTime = 0;
    while (Date.now() < deadline) {
        last = await snap(queue);
        const t = Math.round((BUDGET_MS - (deadline - Date.now())) / 1000);
        const jrn = queue.map(q => `${q.id}=${last!.statuses[q.id]}`).join(' ');
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} ${jrn} qp=${last.qp} runner=${last.runner}`);
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }
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
