/**
 * Live smoke for 1-tile door crossings vs the local engine. Proves the walker
 * drives a genuine 1-tile door crossing to completion (Fix A + the scene-step
 * fallback), instead of wedging one tile from the door for 30-90s until the
 * resilient ladder escalates.
 *
 * Door@(3248,3411) — doors.json locId 1530, dir S, edge (3248,3411)<->(3248,3410)
 * — connects a small building interior (north) to the street (south); the whole
 * z=3411/3410 boundary is solid wall except this door (confirmed by a live
 * collision-flag probe: interior walled at z=3414, street at z=3407), so a
 * radius-0 walk across it is FORCED through the door. Opening the straight door
 * swings its leaf onto a crossing tile (WALK_SCENERY), which makes Reachability
 * refuse the tile — and because a 1-tile door in a solid wall has no bypass, the
 * baked walker click-starves (0 clicks) and wedges. The fix scene-steps through
 * when canReach refuses.
 *
 * CORRECT-SCENE design (no ::tele, no reload — a headless ::tele leaves the scene
 * un-rebuilt, which masks/inverts real door behaviour): walk to the door area
 * naturally from the mainland spawn so the client scene loads the way it does for
 * essminer/shoprun, then cross the door 4 times alternating direction, each a
 * fresh page-ABI Traversal.walkResilient (radius 0). A leg PASSES only if the
 * walk returned true, the bot ended GENUINELY on the exact far tile (radius 0),
 * the walker log shows the door at (3248,3411) was handled (i.e. the door really
 * was on the path), AND it took <= 25s (wedged baseline 30-92s; a driven crossing
 * is single-digit seconds).
 *
 * walkResilient needs a script context (it sleeps via Execution.*), so a single
 * throwaway LoopingBot processes one queued leg per iteration (the
 * tools/lost-pickaxe-test.ts pattern).
 *
 * Requires: engine on :8890 + the local build deployed (deploy-local.sh).
 * Usage: bun tools/door-cross-test.ts [base-url]
 */
import { launchBrowser } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const user = `dc${Date.now().toString(36).slice(-7)}`;

type Tile = { x: number; z: number; level: number };
type LegResult = { ok: boolean; ms: number; end: Tile | null; logs: string[] };

// The two door "landing" tiles — one clear tile PAST each door tile (step + dir),
// exactly where a completed crossing lands. Both are fully-walkable floor
// (probed 0x0), so a radius-0 arrival is a genuine far-side crossing that isn't
// conflated with an unrelated canReach quirk on some tile further in (e.g.
// (3248,3413) is a 0x804 corner tile canReach refuses — a separate Fix-B/C
// matter, not the door). Interior = north of the door (edge 3411/3410).
const INTERIOR: Tile = { x: 3248, z: 3412, level: 0 }; // interior landing (one past door tile 3411)
const STREET: Tile = { x: 3248, z: 3409, level: 0 }; // street landing (one past door tile 3410)

const PASS_MS = 25_000; // driven crossings are single-digit s; wedged ones are 30-92s
const LEG_DEADLINE_MS = 130_000; // > the wedged baseline so a still-wedging leg still returns and is measured

// 4 crossings alternating direction. The bot reaches the STREET side naturally
// (long approach loads the scene), then each leg is a fresh walkResilient to the
// opposite side — a genuine door crossing each time.
const LEGS: { name: string; dest: Tile }[] = [
    { name: 'leg1 street->interior', dest: INTERIOR },
    { name: 'leg2 interior->street', dest: STREET },
    { name: 'leg3 street->interior', dest: INTERIOR },
    { name: 'leg4 interior->street', dest: STREET }
];

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

type BotInstance = { loop(): number | void | Promise<number | void>; onStart?(): void | Promise<void> };
type ScriptMetaLike = { name: string; create(): BotInstance };
type WalkOpts = { radius: number; attempts?: number; timeoutMs?: number; log?: (m: string) => void };
type G = {
    __rs2b0t: {
        Traversal: { walkResilient(dest: Tile, opts: WalkOpts): Promise<boolean> };
        reader: { worldTile(): Tile | null };
        LoopingBot: new () => BotInstance;
        registerScript(manifest: ScriptMetaLike): ScriptMetaLike;
    };
    rs2b0t: { runner: { state: string; start(meta: ScriptMetaLike): void } };
    __doorCmd: { dest: Tile; radius: number } | null;
    __doorResult: LegResult | null;
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    // One persistent command-processor bot: runs walkResilient for each queued
    // leg in a real script context, capturing timing + walker log per leg.
    await page.evaluate(() => {
        const g = globalThis as never as G;
        const abi = g.__rs2b0t;
        g.__doorCmd = null;
        g.__doorResult = null;
        const createBot = (): BotInstance => {
            const bot = new abi.LoopingBot();
            bot.loop = async (): Promise<number | void> => {
                const cmd = g.__doorCmd;
                if (!cmd) { return 250; } // idle: re-poll for a queued leg
                g.__doorCmd = null; // claim it
                const logs: string[] = [];
                const t0 = performance.now();
                const ok = await abi.Traversal.walkResilient(cmd.dest, { radius: cmd.radius, attempts: 6, timeoutMs: 90_000, log: (m: string) => logs.push(m) });
                g.__doorResult = { ok, ms: performance.now() - t0, end: abi.reader.worldTile(), logs };
            };
            return bot;
        };
        g.rs2b0t.runner.start(abi.registerScript({ name: 'DoorCrossSmokeBot', create: createBot }));
    });
    await page.waitForTimeout(1500); // let the runner enter the loop

    const runLeg = async (dest: Tile, radius: number, deadlineMs: number): Promise<LegResult | null> => {
        await page.evaluate(a => { const g = globalThis as never as G; g.__doorResult = null; g.__doorCmd = { dest: a.dest, radius: a.radius }; }, { dest, radius });
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
            const res = await page.evaluate(() => (globalThis as never as G).__doorResult);
            if (res) { return res; }
            await new Promise(r => setTimeout(r, 1000));
        }
        return null;
    };

    // Natural approach: web-walk to the STREET side from the mainland spawn (no
    // ::tele) so the client scene loads correctly around the door. This is a
    // door-free approach (the door is north of the street tile) — not measured.
    console.log('approaching the door area naturally from spawn (loads the scene)...');
    const approach = await runLeg(STREET, 2, 260_000);
    console.log(`approach: ${approach ? `ok=${approach.ok} ${(approach.ms / 1000).toFixed(1)}s end=${JSON.stringify(approach.end)}` : 'TIMED OUT'}`);
    if (!approach || !approach.end) { await fail('never reached the door area (approach failed)'); }

    let allPass = true;
    for (const leg of LEGS) {
        const res = await runLeg(leg.dest, 0, LEG_DEADLINE_MS);
        if (!res) {
            console.error(`FAIL ${leg.name}: no result within ${LEG_DEADLINE_MS / 1000}s (walkResilient did not return)`);
            allPass = false;
            break;
        }
        const secs = (res.ms / 1000).toFixed(1);
        const onFar = res.end !== null && res.end.x === leg.dest.x && res.end.z === leg.dest.z && res.end.level === leg.dest.level;
        const handledDoor = res.logs.some(l => l.includes('(3248,3411)'));
        const sceneStepped = res.logs.some(l => l.includes('scene-stepping')); // the swung-leaf fallback fired
        const inTime = res.ms <= PASS_MS;
        const pass = res.ok && onFar && handledDoor && inTime;
        console.log(`${pass ? 'PASS' : 'FAIL'} ${leg.name}: return=${res.ok} onFarTile=${onFar} doorHandled=${handledDoor} sceneStep=${sceneStepped} time=${secs}s (<=${PASS_MS / 1000}s: ${inTime}) end=${JSON.stringify(res.end)}`);
        if (!pass) {
            console.error(`--- walker log tail (${leg.name}) ---`);
            for (const l of res.logs.slice(-25)) { console.error(`  ${l}`); }
            if (!handledDoor) { console.error('  (no (3248,3411) line — the door may not have been on the path; check endpoints)'); }
            allPass = false;
            break; // fail-fast
        }
    }

    if (!allPass) { await fail('door-cross: a leg did not cross cleanly within 25s'); }
    console.log('PASS: 4/4 one-tile door crossings genuinely on the far side within 25s');
    process.exit(0);
} finally {
    await browser.close();
}
