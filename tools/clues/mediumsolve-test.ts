/**
 * Medium-clue solver live smoke vs the local engine. Proves the full medium
 * trail executor end-to-end over ONE representative of each mechanic, plus the
 * new Karamja SHIP crossing (RT1). Like the easy smoke (tools/cluesolve-test.ts)
 * it asserts ADVANCE (the held clue id is consumed / a "step done"/"trail
 * complete" fires) rather than a fixed trail length, and mirrors its
 * seed-tele-start-poll shape — but each case declares its own MILESTONES so the
 * mechanic under test is proven, not just "something moved".
 *
 * The six sub-cases (each: give the scroll + prereqs, run SolveClue, assert the
 * milestones inside a budget):
 *   1. map dig        — medium_map001 (Asgarnia). Give Spade (bank-seeded).
 *   2. coordinate dig — medium_sextant001 (Misthalin, mainland). Give Sextant +
 *      Watch + Chart (pack) + Spade. ASSERT it does NOT abandon on the engine's
 *      sextant-item require-check (spade.rs2 aborts the dig without all three)
 *      and digs up the casket.
 *   3. kill-for-key   — medium_riddle004 (Chicken — the easiest co-located
 *      fight). Give combat stats; ASSERT the key is looted and the trail advances.
 *   4. anagram talk   — medium_anagram004 (Lowe, Varrock — a plain talk).
 *   5. challenge      — medium_anagram002 (Cook, Lumbridge — a count-dialog
 *      challenge, fixed answer 9). ASSERT the challenge is answered + advance.
 *   6. KARAMJA SHIP   — medium_anagram019 (Kangai Mau, Brimhaven). Give 100 Coins
 *      (fare 30 each way). ASSERT the bot sails Port Sarim->Musa (talk Seaman
 *      Thresnor -> pay -> L1 deck), CROSSES the Gangplank down to the L0 dock
 *      (the RT1 live-watch: if Cross fails the bot strands on L1), walks into
 *      Brimhaven, and reaches/solves the clue.
 *
 * Each case teles the bot beside a mainland bank near its start so SolveClue's
 * bank-first leg stays short (SolveClue always banks at the NEAREST known bank,
 * api/BankLocations — the RockCrab.bankTile override is for crab-banking only).
 * The ship case starts at Draynor bank so the trail walk from there to Brimhaven
 * routes through the ship. Spade + food are BANK-seeded (bankFirst withdraws
 * them); the coordinate items + coins are PACK-seeded (bankFirst keeps but never
 * withdraws Sextant/Watch/Chart, and pack coins guarantee the ship fare).
 *
 * Run one case:  bun tools/clues/mediumsolve-test.ts <case> [base]
 * Run all:       bun tools/clues/mediumsolve-test.ts all  [base]
 *   <case> ∈ map | coord | kill | anagram | challenge | ship | all
 *   base defaults to http://localhost:8890
 */
import { chromium, type Page } from 'playwright-core';
import { cheat, mainlandAccount } from '../tutorial/harness.js';

const rawArgs = process.argv.slice(2);
const base = rawArgs.find(a => a.startsWith('http')) ?? 'http://localhost:8890';
const caseFilter = (rawArgs.find(a => !a.startsWith('http')) ?? 'all').toLowerCase();

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

const worldTile = (): Promise<{ x: number; z: number; level: number } | null> =>
    page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

const runnerState = (): Promise<string> =>
    page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state);

/** world (x,z,level) → the engine's `::tele level,mapX,mapZ,localX,localZ`. */
function teleCmd(x: number, z: number, level: number): string {
    return `tele ${level},${Math.floor(x / 64)},${Math.floor(z / 64)},${x % 64},${z % 64}`;
}

/** Dump the runner log tail + persisted clue traces so a live failure is
 *  diagnosable from the smoke log alone (same recipe as the easy smoke). */
async function dumpTail(label: string): Promise<void> {
    try {
        const tail = (await logLines()).slice(-40);
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

interface Seed {
    /** Extra `::~item <obj> <count>` pack-seeds (coordinate items, coins). */
    packItems?: [string, number][];
    /** Extra `::setstat <skill> <level>` boosts (combat for kill-for-key). */
    stats?: [string, number][];
    /** Skip the bank spade seed — force the bot to acquire one from a spawn. */
    noBankSpade?: boolean;
}

/** Seed bank (spade + food) + a held clue scroll, boost HP (+ optional combat /
 *  extra pack items), point RockCrab at a nearby bank + enable clue solving,
 *  tele to `start`, verify the seeds landed, and start RockCrab. */
async function seedAndStart(clueObj: string, clueId: number, start: [number, number, number], seed: Seed): Promise<void> {
    // Bank-seed the spade + food (bankFirst WITHDRAWS them). Uniform across cases:
    // talk clues just carry a harmless spade; it avoids the "no Spade in the bank"
    // abandon-log noise on dig cases. `noBankSpade` cases test spade acquisition.
    if (!seed.noBankSpade) {
        await cheat(page, '~bankitem spade 1');
    }
    await cheat(page, '~bankitem lobster 30');
    await cheat(page, `~item ${clueObj} 1`);
    // Pack-seed coordinate items / coins (bankFirst keeps but never withdraws these).
    for (const [obj, n] of seed.packItems ?? []) {
        await cheat(page, `~item ${obj} ${n}`);
    }
    // Survive stray random-event attackers on the trek; extra combat for the fight.
    await cheat(page, 'setstat hitpoints 30');
    for (const [sk, lvl] of seed.stats ?? []) {
        await cheat(page, `setstat ${sk} ${lvl}`);
    }

    await page.evaluate(bt => {
        localStorage.setItem('rs2b0t:set:RockCrab:solveClues', 'true');
        localStorage.setItem('rs2b0t:set:RockCrab:bankTile', bt);
    }, `${start[0]},${start[1]},${start[2]}`);

    // Tele LAST so every cheat's canvas-focus click lands in an empty area, not
    // on a bank booth / NPC (a real click there can eat later typed input).
    await cheat(page, teleCmd(start[0], start[1], start[2]));

    const inv = await invItems();
    if (!inv.some(i => i.id === clueId)) {
        throw new Error(`clue ${clueObj} (id ${clueId}) not in the pack after ~item — bad obj name?`);
    }
    for (const [obj] of seed.packItems ?? []) {
        // coins/coordinate items: assert the display item is present (obj name -> item).
        const want = obj.replace(/^trail_/, '').toLowerCase();
        if (!inv.some(i => (i.name ?? '').toLowerCase() === want || (i.name ?? '').toLowerCase().includes(want))) {
            throw new Error(`pack-seed '${obj}' did not land in the pack — bad obj name? (inv: ${inv.map(i => i.name).join(', ')})`);
        }
    }

    await page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t;
        r.runner.start(r.registry.get('RockCrab'));
    });
}

interface MsCtx {
    log: string[];
    inv: { id: number; name: string | null }[];
    tile: { x: number; z: number; level: number } | null;
}
interface Milestone {
    name: string;
    /** Sticky: evaluated each poll; once true it stays achieved. `done` = the
     *  set of already-achieved milestone names (so `advance` can gate on `solving`). */
    test: (c: MsCtx, done: Set<string>) => boolean;
}

const cheb = (a: { x: number; z: number }, x: number, z: number): number => Math.max(Math.abs(a.x - x), Math.abs(a.z - z));

/** The solver logged "solving <clueObj>" — bank-first done, next step identified. */
const solving = (clueObj: string): Milestone => ({
    name: 'solving',
    test: c => c.log.some(l => l.includes('solving') && l.includes(clueObj))
});

/** The trail advanced: the tracked scroll id left the pack, or a step-done /
 *  trail-complete fired. Gated on `solving` so a pre-solve inventory glitch
 *  (the clue is name-protected through banking anyway) can't count as progress. */
const advance = (clueId: number): Milestone => ({
    name: 'advance',
    test: (c, done) => done.has('solving') && (!c.inv.some(i => i.id === clueId) || c.log.some(l => /\[clue\].*(step done|trail complete)/.test(l)))
});

const spadeInPack: Milestone = {
    name: 'spade',
    test: c => c.inv.some(i => (i.name ?? '').toLowerCase() === 'spade')
};

/** All three coordinate items held — proves case 2 did NOT abandon on the
 *  Sextant/Watch/Chart require-check (blockReason / spade.rs2). */
const coordItemsHeld: Milestone = {
    name: 'coord-items',
    test: c => ['sextant', 'watch', 'chart'].every(n => c.inv.some(i => (i.name ?? '').toLowerCase() === n))
};

const keyLooted = (keyId: number): Milestone => ({
    name: 'key-looted',
    test: c => c.inv.some(i => i.id === keyId)
});

const challengeAnswered: Milestone = {
    name: 'challenge-answered',
    test: c => c.log.some(l => /challenge answered/i.test(l))
};

/** Fare paid + landed on the deck (handleSpecialCrossing logs "<label>: sailed"). */
const sailed: Milestone = {
    name: 'sailed',
    test: c => c.log.some(l => /sailed/i.test(l))
};

/** The RT1 live-watch: the Gangplank Cross from the L1 deck to the L0 dock
 *  resolved (handleTransport logs "Cross Gangplank at (..) ok"; crossMultiTileDoor
 *  logs "crossed 'Gangplank'"). A strand on L1 never produces this line. */
const gangplankCrossed: Milestone = {
    name: 'gangplank',
    test: c => c.log.some(l => /gangplank.*\bok\b/i.test(l) || /crossed .*gangplank/i.test(l))
};

/** Stood within `r` of (x,z) at level 0 — the far-region walk arrived. */
const reachedTile = (x: number, z: number, r: number): Milestone => ({
    name: 'reached-target',
    test: c => c.tile !== null && c.tile.level === 0 && cheb(c.tile, x, z) <= r
});

/**
 * Poll the live client until every milestone is achieved (PASS) or the budget
 * runs out / the solve abandons / the runner crashes (FAIL). Milestones are
 * sticky and logged as they land; on FAIL the first unmet one is reported and
 * dumpTail() prints the abandon trace.
 */
async function driveSolve(tag: string, milestones: Milestone[], timeoutMs: number): Promise<void> {
    const done = new Set<string>();
    let lastLevel: number | null = -99;
    let minX = 99999;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const [inv, log, tile, state] = await Promise.all([invItems(), logLines(), worldTile(), runnerState()]);
        if (state === 'crashed') {
            throw new Error(`${tag}: RockCrab crashed mid-solve`);
        }
        // The executor dumps a marked trace block on abandon — fail fast + loud.
        const abandon = log.find(l => /==== clue trace \(abandon/.test(l));
        if (abandon) {
            throw new Error(`${tag}: solve ABANDONED — ${abandon.replace(/^.*abandon: /, '').replace(/\).*$/, '')}`);
        }

        if (tile) {
            if (tile.level !== lastLevel) {
                console.log(`  [${tag}] level=${tile.level} @ (${tile.x},${tile.z})`);
                lastLevel = tile.level;
            }
            minX = Math.min(minX, tile.x);
        }

        const ctx: MsCtx = { log, inv, tile };
        for (const m of milestones) {
            if (!done.has(m.name) && m.test(ctx, done)) {
                done.add(m.name);
                console.log(`  [${tag}] ✓ ${m.name}${tile ? ` @ (${tile.x},${tile.z},${tile.level})` : ''}`);
            }
        }
        if (milestones.every(m => done.has(m.name))) {
            console.log(`  [${tag}] all ${milestones.length} milestones met (min x reached: ${minX})`);
            return;
        }
        await sleep(1000);
    }

    const unmet = milestones.filter(m => !done.has(m.name)).map(m => m.name);
    throw new Error(`${tag}: timed out after ${Math.round(timeoutMs / 1000)}s — unmet: [${unmet.join(', ')}] (achieved: [${[...done].join(', ')}]; min x reached: ${minX})`);
}

interface Case {
    name: string;
    run: () => Promise<void>;
}

const ALL_CASES: Case[] = [
    {
        // map dig: medium_map001 (id 2827) digs a casket at (3093,3227,0), just
        // south of Draynor bank — bank-first is trivial, then a short dig walk.
        name: 'map',
        run: async () => {
            await mainlandAccount(page, base, `mMap${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_map001', 2827, [3093, 3243, 0], {});
            await driveSolve('map', [solving('trail_clue_medium_map001'), spadeInPack, advance(2827)], 420_000);
        }
    },
    {
        // coordinate dig: medium_sextant001 (id 2801) at (3160,3251,0), Misthalin
        // (mainland). Give Sextant+Watch+Chart (pack) + Spade (bank). The engine
        // aborts the dig without all three (spade.rs2), so `coord-items` +
        // `advance` proves the require-check passed and the casket was dug.
        name: 'coord',
        run: async () => {
            await mainlandAccount(page, base, `mCrd${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_sextant001', 2801, [3093, 3243, 0], {
                packItems: [['trail_sextant', 1], ['trail_watch', 1], ['trail_chart', 1]]
            });
            await driveSolve('coord', [solving('trail_clue_medium_sextant001'), coordItemsHeld, spadeInPack, advance(2801)], 480_000);
        }
    },
    {
        // ACQUIRE SPADE: map dig medium_map001 (id 2827) at (3093,3227,0), but the
        // bank is seeded with NO spade — the bot must fetch one from the nearer
        // ground spawn (Falador 2981,3369 from Draynor). Proves ensureSpade end
        // to end: the dig would otherwise abandon on "no Spade held".
        name: 'acquire-spade',
        run: async () => {
            await mainlandAccount(page, base, `mASp${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_map001', 2827, [3093, 3243, 0], { noBankSpade: true });
            await driveSolve('acquire-spade', [solving('trail_clue_medium_map001'), spadeInPack, advance(2827)], 600_000);
        }
    },
    {
        // ACQUIRE COORD TOOLS: coordinate dig medium_sextant002 (id 2803) at
        // (2679,3110,0), near Port Khazard. NO trio pack-seed — the bot must run
        // the professor->Murphy->Kojo->professor chain at bank-first (has_sextant_clue
        // is true because the coord clue is held). Start at Ardougne market, near
        // the chain. `coord-items` proves the trio was acquired live; `advance`
        // proves the dig then produced the casket. Spade IS bank-seeded (isolate
        // the trio chain from spade acquisition, which acquire-spade covers).
        name: 'acquire-coord',
        run: async () => {
            await mainlandAccount(page, base, `mACd${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_sextant002', 2803, [2662, 3305, 0], {});
            await driveSolve('acquire-coord', [solving('trail_clue_medium_sextant002'), coordItemsHeld, advance(2803)], 1_200_000);
        }
    },
    {
        // kill-for-key: medium_riddle004 (id 2837) — kill a Chicken (co-located at
        // the container 2709,3478,0, near Seers bank), loot key 2838, search. Give
        // combat stats so the barehanded fight is quick.
        name: 'kill',
        run: async () => {
            await mainlandAccount(page, base, `mKil${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_riddle004', 2837, [2725, 3491, 0], {
                stats: [['attack', 40], ['strength', 40], ['defence', 20]]
            });
            await driveSolve('kill', [solving('trail_clue_medium_riddle004'), keyLooted(2838), advance(2837)], 600_000);
        }
    },
    {
        // anagram talk: medium_anagram004 (id 2847) — Lowe, Varrock archery store
        // by the east bank (anchor 3232,3423,0). A plain talk (not a challenge).
        name: 'anagram',
        run: async () => {
            await mainlandAccount(page, base, `mAna${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_anagram004', 2847, [3253, 3420, 0], {});
            await driveSolve('anagram', [solving('trail_clue_medium_anagram004'), advance(2847)], 420_000);
        }
    },
    {
        // challenge: medium_anagram002 (id 2843) — Cook, Lumbridge kitchen (anchor
        // 3209,3215,0). Talking poses a count-dialog maths question (fixed answer
        // 9); the executor must answer it. Start at Al Kharid bank (nearest) —
        // one toll-gate crossing west into Lumbridge (bankFirst withdraws coins).
        name: 'challenge',
        run: async () => {
            await mainlandAccount(page, base, `mCha${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_anagram002', 2843, [3269, 3167, 0], {});
            await driveSolve('challenge', [solving('trail_clue_medium_anagram002'), challengeAnswered, advance(2843)], 540_000);
        }
    },
    {
        // KARAMJA SHIP (the new-mechanism test): medium_anagram019 (id 3617) —
        // Kangai Mau, Brimhaven food store (anchor 2791,3182,0). Start at Draynor
        // bank; the trail walk to Brimhaven routes through the Port Sarim->Musa
        // ship. Pack-seed 100 Coins (fare 30) so the fare never depends on a
        // bank withdraw. Milestones prove: sailed (fare paid + on deck), gangplank
        // crossed to L0 (RT1 live-watch), reached Brimhaven, and the clue advanced.
        name: 'ship',
        run: async () => {
            await mainlandAccount(page, base, `mShp${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_anagram019', 3617, [3093, 3243, 0], {
                packItems: [['coins', 100]]
            });
            await driveSolve('ship', [
                solving('trail_clue_medium_anagram019'),
                sailed,
                gangplankCrossed,
                reachedTile(2791, 3182, 12),
                advance(3617)
            ], 1_080_000);
        }
    }
];

const CASES = caseFilter === 'all' ? ALL_CASES : ALL_CASES.filter(c => c.name === caseFilter);
if (CASES.length === 0) {
    console.error(`unknown case '${caseFilter}' — choose one of: ${ALL_CASES.map(c => c.name).join(', ')}, all`);
    process.exit(2);
}

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
        await page.screenshot({ path: `out/mediumsolve-${c.name}.png` }).catch(() => {});
        results.push({ name: c.name, ok: false, sec, detail });
        console.error(`FAIL[${c.name}] (${sec}s): ${detail}`);
    } finally {
        await page.close().catch(() => {});
    }
}

await browser.close();

console.log('\n=== summary ===');
for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(10)} ${String(r.sec).padStart(4)}s  ${r.detail ?? ''}`);
}

const failed = results.filter(r => !r.ok);
if (failed.length) {
    console.error(`FAIL: ${failed.length}/${results.length} medium clue-solve case(s) failed`);
    process.exit(1);
}
console.log(`PASS: ${results.length}/${results.length} medium clue-solve case(s)`);
process.exit(0);
