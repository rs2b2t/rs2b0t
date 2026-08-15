// Live proof — Strange box ("Mysterious box") random event under a running script: [base].
// Why: the engine replicates the box every ~90s and on every wrong answer, up to a 28-slot pack, so the guardian/Supervisor must solve it mid-run and let the script resume.

//   bun e2e/strangebox-underscript-live.ts [http://localhost:8888]
import { launchBrowser, parseArgs } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8888' });
const USER = process.env.USER_NAME || `sbu${Date.now().toString(36).slice(-7)}`;
const SCRIPT = process.env.SCRIPT || 'Woodcutter';
const ROUNDS = Number(process.env.ROUNDS) || 3;
const QTY = Number(process.env.QTY) || 5;

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; used(): number; items(): { id: number; name: string | null; count: number }[] };
        reader: { worldTile(): { x: number; z: number; level: number } | null; modals(): { main: number } };
    };
    rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
}

const snap = (page: import('playwright-core').Page) =>
    page.evaluate(() => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        return {
            boxes: api.Inventory.count('Strange box'),
            used: api.Inventory.used(),
            main: api.reader.modals().main,
            tile: api.reader.worldTile(),
            state: g.rs2b0t.runner.state,
            log: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
        };
    });

const browser = await launchBrowser();
const page = await browser.newPage();
page.on('console', m => {
    const t = m.text();
    if (/random event/i.test(t)) console.log(`  [console] ${t}`);
});

let failures = 0;
try {
    await mainlandAccount(page, base, USER);
    await cheatQuiet(page, 'setstat woodcutting 60', 900);
    await cheatQuiet(page, 'give rune_axe 1', 900);

    await startScript(page, SCRIPT);
    console.log(`started ${SCRIPT}; letting it settle`);
    await page.waitForTimeout(15_000);

    for (let round = 1; round <= ROUNDS; round++) {
        const pre = await snap(page);
        console.log(`\n=== round ${round} === pre: state=${pre.state} used=${pre.used} boxes=${pre.boxes} tile=${JSON.stringify(pre.tile)}`);
        await cheatQuiet(page, `give macro_cube ${QTY}`, 300);

        // Engine replicates at 150 ticks (~90s); give the solver 75s to clear it.
        const deadline = Date.now() + 75_000;
        let cleared = false;
        let peak = 0;
        while (Date.now() < deadline) {
            const s = await snap(page);
            peak = Math.max(peak, s.boxes);
            if (peak > 0 && s.boxes === 0) {
                cleared = true;
                console.log(`  cleared after ${Math.round((75_000 - (deadline - Date.now())) / 1000)}s (peak=${peak}) state=${s.state}`);
                break;
            }
            await page.waitForTimeout(1000);
        }
        if (peak < QTY) {
            console.log(`  WARN sampler only ever saw peak=${peak} of ${QTY} seeded boxes`);
        }
        if (!cleared) {
            const s = await snap(page);
            console.log(`  NOT CLEARED boxes=${s.boxes} used=${s.used} main=${s.main} state=${s.state}`);
            console.log(`  log: ${JSON.stringify(s.log, null, 2)}`);
            failures++;
        }

        const post = await snap(page);
        if (post.state !== 'running') {
            console.log(`  SCRIPT NOT RUNNING after event: state=${post.state}`);
            failures++;
        }
        console.log(`  post: state=${post.state} used=${post.used} boxes=${post.boxes} tile=${JSON.stringify(post.tile)}`);
        await page.waitForTimeout(8000);
    }

    const fin = await snap(page);
    const solvedLines = fin.log.filter(m => /solved \d+ strange box/.test(m));
    const totalSolved = solvedLines.reduce((n, m) => n + Number(/solved (\d+)/.exec(m)?.[1] ?? 0), 0);
    console.log(`\nfinal: state=${fin.state} boxes=${fin.boxes} used=${fin.used}`);
    console.log(`solved tally: ${totalSolved} boxes across ${solvedLines.length} handler passes (expected ${ROUNDS * QTY})`);
    if (totalSolved < ROUNDS * QTY) {
        console.log('  MISMATCH — not every seeded box was solved');
        failures++;
    }
    console.log('--- event log ---');
    for (const m of fin.log.filter(m => /random event|watchdog/i.test(m))) console.log(`  ${m}`);
    console.log(failures === 0 ? '\nPASS — box solved under a running script every round' : `\nFAIL — ${failures} problem(s)`);
} finally {
    await browser.close();
}
process.exit(failures === 0 ? 0 : 1);
