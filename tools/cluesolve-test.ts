/**
 * ClueSolver live smoke vs the local engine. Proves the RockCrab easy-clue
 * solve chain end to end for two step types, asserting ADVANCE (trails are RNG
 * length) rather than a fixed trail length:
 *
 *   1. Ground talk (simple021 / Ned, Draynor): a held clue → SolveClue banks
 *      first → walks to Ned → talks → the trail advances (the held clue id
 *      changes, or a "step done"/"trail complete" fires).
 *   2. Upstairs search (simple011 / Varrock East bank drawers, level 1): banks
 *      first → baked stair CLIMB to level 1 → searches the drawers → the step
 *      solves → DESCENT back to level 0. The descent is the empirical test for
 *      the reverse stair edge (the T2-flagged gap).
 *
 * Each case teles beside a bank close to its clue and overrides
 * `RockCrab.bankTile` so both legs (bank-first + trail) stay short — the smoke
 * tests the SOLVER, not a 1/128 crab farm. The spade + food are BANK-seeded (not
 * pack-seeded) so `bankFirst`'s withdraw path is exercised: the #1 predicted bug
 * is the hyphen "Withdraw-1" op not matching the real space "Withdraw 1", so a
 * hard "spade withdrawn from the bank" assertion surfaces it.
 *
 * Run: bun tools/cluesolve-test.ts [http://localhost:8890]
 */
import { chromium, type Page } from 'playwright-core';
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

// The active case's page — reassigned per case so the readers/fail dump target
// whichever client is live. Only one client runs at a time (closed between cases).
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

/** Dump the runner log tail so a live failure is diagnosable from the smoke log alone. */
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
}

/** Seed the bank + a held clue, point RockCrab at a nearby bank, tele beside it, and start. */
async function seedAndStart(clueObj: string, clueId: number, bankTileStr: string, teleCmd: string): Promise<void> {
    // Bank-seed the spade + food (NOT pack-seed): bankFirst must WITHDRAW them,
    // exercising the withdraw-op path. Pack-seed only the clue scroll.
    await cheat(page, '~bankitem spade 1');
    await cheat(page, '~bankitem lobster 30');
    await cheat(page, `~item ${clueObj} 1`);
    // Survive a stray random-event attacker on the trek (no crab combat here).
    await cheat(page, 'setstat hitpoints 30');

    await page.evaluate(bt => {
        localStorage.setItem('rs2b0t:set:RockCrab:solveClues', 'true');
        localStorage.setItem('rs2b0t:set:RockCrab:bankTile', bt);
    }, bankTileStr);

    // Tele LAST so every cheat's canvas-focus click lands in an empty area, not
    // on a bank booth / NPC (a real click there can eat later typed input).
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

/**
 * Poll the live client until the clue step solves and the trail advances. One
 * race-free loop tracks every signal each second so no transient (a brief L1
 * visit, a mid-tick id swap) is missed:
 *   - solving:  the solver logged "solving <clueObj>" (bank-first done, step id'd)
 *   - spade:    the bank-seeded spade reached the pack (withdraw op works)
 *   - climb:    worldTile().level hit 1 (needClimb cases — baked stair up)
 *   - advance:  the held clue id left the pack, or a step-done/complete fired
 *   - descent:  back to level 0 after the climb+advance (needClimb — reverse edge)
 * Throws the FIRST unmet condition on timeout (or an early, clear spade failure).
 */
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
        // Advance only counts once the step was actually attempted (guards against
        // a spurious "id gone" — the clue is name-protected through banking).
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

        // Fail fast + loud on the predicted withdraw bug: the spade is withdrawn
        // BEFORE the "solving" log, so if it's missing 30s after, the op didn't fire.
        if (solvingSeen && !spadeSeen && Date.now() - solvingAt > 30_000) {
            throw new Error(`${tag}: spade never reached the pack within 30s of banking — RockCrab bankFirst uses the hyphen op "Withdraw-1"; the real bank op is the space "Withdraw 1". Read it off the item (cf. EssMiner withdrawOneOp).`);
        }
        await sleep(1000);
    }

    // Timed out — report the first unmet condition, most-upstream first.
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
        // Ned is in Draynor; Draynor bank (3092,3243) is its nearest bank, so
        // both bank-first and the walk to Ned stay short.
        name: 'ground-talk',
        run: async () => {
            await mainlandAccount(page, base, `clueA${Date.now() % 100000}`);
            await seedAndStart('trail_clue_easy_simple021', 2697, '3092,3243,0', 'tele 0,48,50,20,43');
            await driveSolve('trail_clue_easy_simple021', 2697, false, 240_000);
        }
    },
    {
        // simple011's drawers are upstairs at the Varrock East bank; bank there
        // (3251,3420) so bank-first is trivial and the trail is a stair climb.
        name: 'upstairs-search',
        run: async () => {
            await mainlandAccount(page, base, `clueB${Date.now() % 100000}`);
            await seedAndStart('trail_clue_easy_simple011', 2687, '3251,3420,0', 'tele 0,50,53,51,28');
            await driveSolve('trail_clue_easy_simple011', 2687, true, 300_000);
        }
    }
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
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
