import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `mt${Date.now().toString(36).slice(-6)}`;
const budgetMin = Number(process.argv[4]) || 35;
const BUDGET_MS = budgetMin * 60_000;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

const GIVES = ['coins 50000', 'bread 1', 'insect_repellent 1', 'bucket_empty 1', 'tinderbox 1', 'bat_bones 1', 'trout 10'];

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
    await page.waitForTimeout(3000);
    console.log(`mainland-ready as '${username}'`);

    for (const g of GIVES) {
        if (!(await cheatQuiet(page, `~item ${g}`))) { fail(`give '~item ${g}' not sent`); }
        console.log(`gave ${g}`);
    }

    await page.evaluate(() => localStorage.setItem('rs2b0t:set:AIOQuester:quests', 'arthur'));
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — bot will start the quest at King Arthur, then jump to stage 4');

    const snap = (): Promise<Snapshot> => page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null }; Quests: { status(n: string): string; points(): number } };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status("Merlin's Crystal"),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-60).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    });

    const deadline = Date.now() + BUDGET_MS;
    let last: Snapshot | null = null;
    let lastLogTime = 0;
    let jumped = false;
    while (Date.now() < deadline) {
        last = await snap();
        const t = Math.round((Date.now() - t0) / 1000);
        if (!jumped && last.status === 'inProgress') {
            for (let i = 0; i < 4; i++) { await cheatQuiet(page, 'setvar arthur 4'); await page.waitForTimeout(600); }
            jumped = true;
            console.log(`  [${t}s] quest started -> set arthur=4 (server stage spoken_morgan_lefaye)`);
        }
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} arthur=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const l of last.logs) { if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); } }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }
        if (last.status === 'complete' && last.runner !== 'running') { break; }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    if (last.status !== 'complete') { fail(`arthur not complete within ${budgetMin}min [arthur=${last.status}] qp=${last.qp} runner=${last.runner}`); }
    if (last.qp < 6) { fail(`qp ${last.qp}, expected 6`); }
    console.log(`PASS (arthur complete, QP=${last.qp}, clean stop)`);
} finally {
    await browser.close();
}
