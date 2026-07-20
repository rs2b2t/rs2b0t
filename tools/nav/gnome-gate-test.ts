/**
 * Live smoke for the Gnome Stronghold entrance gate (gnome_areagate) + Femi's
 * first-time "lift these boxes" prerequisite, vs the local engine.
 *
 * The gate is a 5x2 blocking centrepiece; the middle passage is x=2461, entering
 * is south (2461,3382) -> north (2461,3385). On a fresh account (%femi_help=0),
 * the FIRST Open from the south diverts to Femi's boxes dialogue instead of
 * opening (@grandtree_femi_boxes is a goto — the gate-open code never runs that
 * click); a SECOND Open then force-moves you through. handleSpecialCrossing's
 * reopenAfterDialogue path drives the boxes ("OK then") then re-Opens.
 *
 * A fresh mainlandAccount has %femi_help=0, so this proves the real first-time
 * path. We ::tele ~16 tiles SOUTH of the gate (a fresh scene rebuilds as the
 * ~16-tile approach walks in, the way essminer/shoprun load a far scene — a
 * radius-0 cross immediately after ::tele would read stale collision), then:
 *   leg1 enter  (first-time): walkResilient to a tile INSIDE — must cross despite
 *                the boxes dialogue, log "Gnome Stronghold gate ...: crossed".
 *   leg2 leave:  walk back out (plain Open via crossMultiTileDoor).
 *   leg3 re-enter (primed): %femi_help now set — must cross FAST, no boxes.
 *
 * Requires: engine on :8890 + the local build deployed (deploy-local.sh).
 * Usage: bun tools/nav/gnome-gate-test.ts [base-url]
 */
import { chromium } from 'playwright-core';
import { mainlandAccount, cheat } from '../tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const user = `gg${Date.now().toString(36).slice(-7)}`;

type Tile = { x: number; z: number; level: number };
type LegResult = { ok: boolean; ms: number; end: Tile | null; logs: string[] };

const START: Tile = { x: 2461, z: 3366, level: 0 }; // ~16 tiles south, walkable, routes via the gate
const INSIDE: Tile = { x: 2461, z: 3390, level: 0 }; // north of the gate, inside the stronghold
const OUTSIDE: Tile = { x: 2461, z: 3378, level: 0 }; // south of the gate, outside

const FIRST_MS = 120_000; // first-time: ~16-tile walk + boxes dialogue (~20-30s) + the second Open
const PRIMED_MS = 40_000; // primed re-cross: walk + a single Open force-move, no boxes
const LEG_DEADLINE_MS = 180_000;

/** world (x,z,level) -> the engine's `::tele level,mapX,mapZ,localX,localZ`. */
function teleCmd(x: number, z: number, level: number): string {
    return `tele ${level},${Math.floor(x / 64)},${Math.floor(z / 64)},${x % 64},${z % 64}`;
}

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
    __gateCmd: { dest: Tile; radius: number } | null;
    __gateResult: LegResult | null;
};

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}' (fresh account => %femi_help=0)`);

    await cheat(page, 'setstat hitpoints 30'); // survive any stray random-event attacker on the approach
    await cheat(page, teleCmd(START.x, START.z, START.level));
    console.log(`teled to (${START.x},${START.z},${START.level}), ~16 tiles south of the gate`);

    await page.evaluate(() => {
        const g = globalThis as never as G;
        const abi = g.__rs2b0t;
        g.__gateCmd = null;
        g.__gateResult = null;
        const createBot = (): BotInstance => {
            const bot = new abi.LoopingBot();
            bot.loop = async (): Promise<number | void> => {
                const cmd = g.__gateCmd;
                if (!cmd) { return 250; }
                g.__gateCmd = null;
                const logs: string[] = [];
                const t0 = performance.now();
                const ok = await abi.Traversal.walkResilient(cmd.dest, { radius: cmd.radius, attempts: 6, timeoutMs: 150_000, log: (m: string) => logs.push(m) });
                g.__gateResult = { ok, ms: performance.now() - t0, end: abi.reader.worldTile(), logs };
            };
            return bot;
        };
        g.rs2b0t.runner.start(abi.registerScript({ name: 'GnomeGateSmokeBot', create: createBot }));
    });
    await page.waitForTimeout(1500);

    const runLeg = async (dest: Tile, radius: number, deadlineMs: number): Promise<LegResult | null> => {
        await page.evaluate(a => { const g = globalThis as never as G; g.__gateResult = null; g.__gateCmd = { dest: a.dest, radius: a.radius }; }, { dest, radius });
        const deadline = Date.now() + deadlineMs;
        while (Date.now() < deadline) {
            const res = await page.evaluate(() => (globalThis as never as G).__gateResult);
            if (res) { return res; }
            await new Promise(r => setTimeout(r, 1000));
        }
        return null;
    };

    const gateCrossed = (logs: string[]): boolean => logs.some(l => l.includes('Gnome Stronghold gate') && l.includes('crossed'));
    let allPass = true;

    // leg1 — first-time enter: must drive the boxes dialogue then cross.
    {
        const res = await runLeg(INSIDE, 0, LEG_DEADLINE_MS);
        if (!res) { fail('leg1 enter: walkResilient did not return'); }
        const onDest = res.end !== null && res.end.x === INSIDE.x && res.end.z === INSIDE.z && res.end.level === 0;
        const crossedGate = gateCrossed(res.logs);
        const inTime = res.ms <= FIRST_MS;
        const pass = res.ok && onDest && crossedGate && inTime;
        console.log(`${pass ? 'PASS' : 'FAIL'} leg1 first-time enter: return=${res.ok} onInside=${onDest} gateCrossedLog=${crossedGate} time=${(res.ms / 1000).toFixed(1)}s (<=${FIRST_MS / 1000}s: ${inTime}) end=${JSON.stringify(res.end)}`);
        if (!pass) { console.error('--- leg1 walker log tail ---'); for (const l of res.logs.slice(-30)) console.error(`  ${l}`); allPass = false; }
    }

    // leg2 — leave (plain Open, north->south).
    if (allPass) {
        const res = await runLeg(OUTSIDE, 0, LEG_DEADLINE_MS);
        if (!res) { fail('leg2 leave: walkResilient did not return'); }
        const onDest = res.end !== null && res.end.x === OUTSIDE.x && res.end.z === OUTSIDE.z && res.end.level === 0;
        const pass = res.ok && onDest;
        console.log(`${pass ? 'PASS' : 'FAIL'} leg2 leave: return=${res.ok} onOutside=${onDest} time=${(res.ms / 1000).toFixed(1)}s end=${JSON.stringify(res.end)}`);
        if (!pass) { console.error('--- leg2 walker log tail ---'); for (const l of res.logs.slice(-30)) console.error(`  ${l}`); allPass = false; }
    }

    // leg3 — primed re-enter: %femi_help set, so it must cross FAST with no boxes.
    if (allPass) {
        const res = await runLeg(INSIDE, 0, LEG_DEADLINE_MS);
        if (!res) { fail('leg3 re-enter: walkResilient did not return'); }
        const onDest = res.end !== null && res.end.x === INSIDE.x && res.end.z === INSIDE.z && res.end.level === 0;
        const crossedGate = gateCrossed(res.logs);
        const inTime = res.ms <= PRIMED_MS;
        const pass = res.ok && onDest && crossedGate && inTime;
        console.log(`${pass ? 'PASS' : 'FAIL'} leg3 primed re-enter: return=${res.ok} onInside=${onDest} gateCrossedLog=${crossedGate} time=${(res.ms / 1000).toFixed(1)}s (<=${PRIMED_MS / 1000}s no-boxes: ${inTime}) end=${JSON.stringify(res.end)}`);
        if (!pass) { console.error('--- leg3 walker log tail ---'); for (const l of res.logs.slice(-30)) console.error(`  ${l}`); allPass = false; }
    }

    if (!allPass) { fail('gnome-gate: a leg did not cross cleanly'); }
    console.log('PASS: first-time boxes handled + leave + primed re-cross, all genuine gate crossings');
    process.exit(0);
} finally {
    await browser.close();
}
