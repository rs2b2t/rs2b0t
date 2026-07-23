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

function teleCmd(x: number, z: number, level: number): string {
    return `tele ${level},${Math.floor(x / 64)},${Math.floor(z / 64)},${x % 64},${z % 64}`;
}

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
    packItems?: [string, number][];
    stats?: [string, number][];
    noBankSpade?: boolean;
}

async function seedAndStart(clueObj: string, clueId: number, start: [number, number, number], seed: Seed): Promise<void> {
    if (!seed.noBankSpade) {
        await cheat(page, '~bankitem spade 1');
    }
    await cheat(page, '~bankitem lobster 30');
    await cheat(page, `~item ${clueObj} 1`);
    for (const [obj, n] of seed.packItems ?? []) {
        await cheat(page, `~item ${obj} ${n}`);
    }
    await cheat(page, 'setstat hitpoints 30');
    for (const [sk, lvl] of seed.stats ?? []) {
        await cheat(page, `setstat ${sk} ${lvl}`);
    }

    await page.evaluate(bt => {
        localStorage.setItem('rs2b0t:set:RockCrab:solveClues', 'true');
        localStorage.setItem('rs2b0t:set:RockCrab:bankTile', bt);
    }, `${start[0]},${start[1]},${start[2]}`);

    await cheat(page, teleCmd(start[0], start[1], start[2]));

    const inv = await invItems();
    if (!inv.some(i => i.id === clueId)) {
        throw new Error(`clue ${clueObj} (id ${clueId}) not in the pack after ~item — bad obj name?`);
    }
    for (const [obj] of seed.packItems ?? []) {
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
    test: (c: MsCtx, done: Set<string>) => boolean;
}

const cheb = (a: { x: number; z: number }, x: number, z: number): number => Math.max(Math.abs(a.x - x), Math.abs(a.z - z));

const solving = (clueObj: string): Milestone => ({
    name: 'solving',
    test: c => c.log.some(l => l.includes('solving') && l.includes(clueObj))
});

const advance = (clueId: number): Milestone => ({
    name: 'advance',
    test: (c, done) => done.has('solving') && (!c.inv.some(i => i.id === clueId) || c.log.some(l => /\[clue\].*(step done|trail complete)/.test(l)))
});

const spadeInPack: Milestone = {
    name: 'spade',
    test: c => c.inv.some(i => (i.name ?? '').toLowerCase() === 'spade')
};

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

const sailed: Milestone = {
    name: 'sailed',
    test: c => c.log.some(l => /sailed/i.test(l))
};

const gangplankCrossed: Milestone = {
    name: 'gangplank',
    test: c => c.log.some(l => /gangplank.*\bok\b/i.test(l) || /crossed .*gangplank/i.test(l))
};

const reachedTile = (x: number, z: number, r: number): Milestone => ({
    name: 'reached-target',
    test: c => c.tile !== null && c.tile.level === 0 && cheb(c.tile, x, z) <= r
});

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
        name: 'map',
        run: async () => {
            await mainlandAccount(page, base, `mMap${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_map001', 2827, [3093, 3243, 0], {});
            await driveSolve('map', [solving('trail_clue_medium_map001'), spadeInPack, advance(2827)], 420_000);
        }
    },
    {
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
        name: 'acquire-spade',
        run: async () => {
            await mainlandAccount(page, base, `mASp${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_map001', 2827, [3093, 3243, 0], { noBankSpade: true });
            await driveSolve('acquire-spade', [solving('trail_clue_medium_map001'), spadeInPack, advance(2827)], 600_000);
        }
    },
    {
        name: 'acquire-coord',
        run: async () => {
            await mainlandAccount(page, base, `mACd${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_sextant002', 2803, [2662, 3305, 0], {});
            await driveSolve('acquire-coord', [solving('trail_clue_medium_sextant002'), coordItemsHeld, advance(2803)], 1_200_000);
        }
    },
    {
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
        name: 'anagram',
        run: async () => {
            await mainlandAccount(page, base, `mAna${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_anagram004', 2847, [3253, 3420, 0], {});
            await driveSolve('anagram', [solving('trail_clue_medium_anagram004'), advance(2847)], 420_000);
        }
    },
    {
        name: 'challenge',
        run: async () => {
            await mainlandAccount(page, base, `mCha${Date.now() % 100000}`);
            await seedAndStart('trail_clue_medium_anagram002', 2843, [3269, 3167, 0], {});
            await driveSolve('challenge', [solving('trail_clue_medium_anagram002'), challengeAnswered, advance(2843)], 540_000);
        }
    },
    {
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

const browser = await chromium.launch({ channel: 'chrome', headless: !process.env.HEADED, slowMo: process.env.HEADED ? 50 : 0 });
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
