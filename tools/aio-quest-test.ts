import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';
import { QUESTS } from '../src/bot/quests/data/quests.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `aq${Date.now().toString(36).slice(-7)}`;
const questsCsv = (process.argv[4] || 'runemysteries').trim();
const budgetMin = Number(process.argv[5]) || 25;
const giveCsv = (process.argv[6] || '').trim();
const statsCsv = (process.argv[7] || '').trim();
const foodSetting = (process.argv[8] || '').trim();
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

    for (const pair of giveCsv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `~item ${obj} ${Number(n) || 1}`))) {
            fail(`account prep '~item ${pair}' not sent (not ingame?)`);
        }
        console.log(`gave ${pair}`);
    }

    for (const pair of statsCsv.split(',').map(s => s.trim()).filter(s => s.length > 0)) {
        const [stat, lvl] = pair.split(':');
        if (!(await cheatQuiet(page, `advancestat ${stat} ${Number(lvl) || 1}`))) {
            fail(`account prep 'advancestat ${pair}' not sent (not ingame?)`);
        }
        console.log(`advanced ${pair}`);
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
