import { launchBrowser } from './lib/harness.js';
import { type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';

interface R {
    rs2b0t: {
        runner: { start(m: unknown): void; state: string; ctx?: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        reader: {
            inventory(): { id: number; name: string | null }[];
            worldTile(): { x: number; z: number; level: number } | null;
        };
    };
}

let page: Page;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

const logLines = (): Promise<string[]> =>
    page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

const invItems = (): Promise<{ id: number; name: string | null }[]> =>
    page.evaluate(() => (globalThis as never as R).rs2b0t.reader.inventory().map(i => ({ id: i.id, name: i.name })));

const levelOf = (): Promise<number | null> =>
    page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile()?.level ?? null);

const runnerState = (): Promise<string> =>
    page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state);

async function dumpTail(label: string): Promise<void> {
    try {
        const tail = (await logLines()).slice(-30);
        console.error(`--- ${label}: last runner log lines (tail) ---`);
        for (const line of tail) {
            console.error(`  ${line}`);
        }
    } catch (err) {
        console.error(`(could not read runner log: ${err instanceof Error ? err.message : String(err)})`);
    }
    try {
        const traces = await page.evaluate(() => (globalThis as never as { rs2b0t: { clueTraces(): unknown } }).rs2b0t.clueTraces());
        console.error(`--- ${label}: persisted clue-failure traces (newest first) ---`);
        console.error(JSON.stringify(traces, null, 2));
    } catch (err) {
        console.error(`(could not read clue traces: ${err instanceof Error ? err.message : String(err)})`);
    }
}

async function seedAndStart(clueObj: string, clueId: number, bankTileStr: string, teleCmd: string): Promise<void> {
    await cheat(page, '~bankitem spade 1');
    await cheat(page, '~bankitem lobster 30');
    await cheat(page, `~item ${clueObj} 1`);
    await cheat(page, 'setstat hitpoints 30');

    await page.evaluate(bt => {
        sessionStorage.setItem('rs2b0t:set:RockCrab:solveClues', 'true');
        sessionStorage.setItem('rs2b0t:set:RockCrab:bankTile', bt);
    }, bankTileStr);

    await cheat(page, teleCmd);

    const inv = await invItems();
    if (!inv.some(i => i.id === clueId)) {
        throw new Error(`clue ${clueObj} (id ${clueId}) not in the pack after ~item — bad obj name?`);
    }

    await page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t;
        r.runner.start(r.registry.get('RockCrab'));
    });
}

async function driveSolve(clueObj: string, clueId: number, needClimb: boolean, timeoutMs: number): Promise<void> {
    let solvingSeen = false;
    let solvingAt = 0;
    let spadeSeen = false;
    let sawL1 = false;
    let advanced = false;
    let sawL0After = false;
    let lastLevel: number | null = -1;
    const tag = clueObj.replace('trail_clue_easy_', '');
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const [lvl, inv, log, state] = await Promise.all([levelOf(), invItems(), logLines(), runnerState()]);
        if (state === 'crashed') {
            throw new Error(`${tag}: RockCrab crashed mid-solve`);
        }

        if (lvl !== lastLevel) {
            console.log(`  [${tag}] level=${lvl}`);
            lastLevel = lvl;
        }
        if (lvl === 1) {
            sawL1 = true;
        }
        if (!solvingSeen && log.some(l => l.includes('solving') && l.includes(clueObj))) {
            solvingSeen = true;
            solvingAt = Date.now();
            console.log(`  [${tag}] solver identified the step`);
        }
        if (!spadeSeen && inv.some(i => (i.name ?? '').toLowerCase() === 'spade')) {
            spadeSeen = true;
            console.log(`  [${tag}] spade withdrawn from the bank`);
        }
        if (!advanced && solvingSeen && (!inv.some(i => i.id === clueId) || log.some(l => /\[clue\].*(step done|trail complete)/.test(l)))) {
            advanced = true;
            console.log(`  [${tag}] trail advanced (clue ${clueId} consumed)`);
            if (log.some(l => /trail complete/.test(l))) {
                console.log(`  [${tag}] trail complete — reward collected`);
            }
        }
        if (advanced && (!needClimb || sawL1) && lvl === 0) {
            sawL0After = true;
        }

        if (solvingSeen && spadeSeen && advanced && (!needClimb || (sawL1 && sawL0After))) {
            return;
        }

        if (solvingSeen && !spadeSeen && Date.now() - solvingAt > 30_000) {
            throw new Error(`${tag}: spade never reached the pack within 30s of banking — RockCrab bankFirst uses the hyphen op "Withdraw-1"; the real bank op is the space "Withdraw 1". Read it off the item (cf. EssMiner withdrawOneOp).`);
        }
        await sleep(1000);
    }

    if (!solvingSeen) {
        throw new Error(`${tag}: solver never logged "solving ${clueObj}" — bank-first walk/open failed?`);
    }
    if (!spadeSeen) {
        throw new Error(`${tag}: spade never withdrawn from the bank — withdraw op mismatch (hyphen vs space)?`);
    }
    if (needClimb && !sawL1) {
        throw new Error(`${tag}: bot never reached level 1 — the baked stair CLIMB to the upstairs failed`);
    }
    if (!advanced) {
        throw new Error(`${tag}: step did not solve — clue ${clueId} still held, no "step done"/"trail complete"`);
    }
    if (needClimb && !sawL0After) {
        throw new Error(`${tag}: never returned to level 0 after solving — the DESCENT (reverse stair edge) failed`);
    }
    throw new Error(`${tag}: timed out (unexpected — all tracked conditions appeared met)`);
}

interface Case {
    name: string;
    run: () => Promise<void>;
}

const CASES: Case[] = [
    {
        name: 'ground-talk',
        run: async () => {
            await mainlandAccount(page, base, `clueA${Date.now() % 100000}`);
            await seedAndStart('trail_clue_easy_simple021', 2697, '3092,3243,0', 'tele 0,48,50,20,43');
            await driveSolve('trail_clue_easy_simple021', 2697, false, 240_000);
        }
    },
    {
        name: 'upstairs-search',
        run: async () => {
            await mainlandAccount(page, base, `clueB${Date.now() % 100000}`);
            await seedAndStart('trail_clue_easy_simple011', 2687, '3251,3420,0', 'tele 0,50,53,51,28');
            await driveSolve('trail_clue_easy_simple011', 2687, true, 300_000);
        }
    }
];

const browser = await launchBrowser();
const results: { name: string; ok: boolean; sec: number; detail?: string }[] = [];

for (const c of CASES) {
    const start = Date.now();
    console.log(`\n=== case: ${c.name} ===`);
    page = await browser.newPage();
    page.on('pageerror', e => console.error('pageerror:', e.message));
    try {
        await c.run();
        const sec = Math.round((Date.now() - start) / 1000);
        results.push({ name: c.name, ok: true, sec });
        console.log(`PASS[${c.name}] (${sec}s)`);
    } catch (err) {
        const sec = Math.round((Date.now() - start) / 1000);
        const detail = err instanceof Error ? err.message : String(err);
        await dumpTail(c.name);
        await page.screenshot({ path: `out/cluesolve-${c.name}.png` }).catch(() => {});
        results.push({ name: c.name, ok: false, sec, detail });
        console.error(`FAIL[${c.name}] (${sec}s): ${detail}`);
    } finally {
        await page.close().catch(() => {});
    }
}

await browser.close();

console.log('\n=== summary ===');
for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(16)} ${String(r.sec).padStart(4)}s  ${r.detail ?? ''}`);
}

const failed = results.filter(r => !r.ok);
if (failed.length) {
    console.error(`FAIL: ${failed.length}/${results.length} clue-solve case(s) failed`);
    process.exit(1);
}
console.log(`PASS: ${results.length}/${results.length} clue-solve cases (ground talk + upstairs search)`);
process.exit(0);
