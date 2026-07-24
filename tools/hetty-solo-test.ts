import { launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = process.argv[3] || `wp${Date.now().toString(36).slice(-7)}`;
const budgetMin = Number(process.argv[4]) || 40;
const BUDGET_MS = budgetMin * 60_000;
const QUEST_NAME = "Witch's Potion";

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

    if (!(await cheatQuiet(page, '~item coins 2000'))) { fail('seed coins not sent'); }
    const packCoins = await page.evaluate(() => (globalThis as never as { __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[] } } }).__rs2b0t.Inventory.items().filter(i => i.name === 'Coins').reduce((s, i) => s + i.count, 0));
    console.log(`seeded coins — pack now holds ${packCoins} (walks from the Lumbridge spawn)`);
    if (packCoins < 1000) { fail(`coin seed did not land (pack has ${packCoins})`); }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'hetty'));
    await startScript(page, 'AIOQuester');
    console.log("started AIOQuester — watching Witch's Potion");

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
        console.log(`  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'} witchspotion=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const l of last.logs) { if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); } }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }
        if (last.status === 'complete' && last.runner !== 'running') { break; }
        await page.waitForTimeout(10_000);
    }

    if (!last) { fail('no snapshot'); }
    if (last.status !== 'complete') { fail(`Witch's Potion not complete within ${budgetMin}min [status=${last.status}] qp=${last.qp} runner=${last.runner}`); }
    console.log(`PASS (Witch's Potion journal complete, QP=${last.qp})`);
} finally {
    await browser.close();
}
