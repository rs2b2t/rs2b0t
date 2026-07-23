import { launchBrowser } from './lib/harness.js';
import { mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const user = `dc${Date.now().toString(36).slice(-7)}`;

type Tile = { x: number; z: number; level: number };
type LegResult = { ok: boolean; ms: number; end: Tile | null; logs: string[] };

const INTERIOR: Tile = { x: 3248, z: 3412, level: 0 };
const STREET: Tile = { x: 3248, z: 3409, level: 0 };

const PASS_MS = 25_000;
const LEG_DEADLINE_MS = 130_000;

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

    await page.evaluate(() => {
        const g = globalThis as never as G;
        const abi = g.__rs2b0t;
        g.__doorCmd = null;
        g.__doorResult = null;
        const createBot = (): BotInstance => {
            const bot = new abi.LoopingBot();
            bot.loop = async (): Promise<number | void> => {
                const cmd = g.__doorCmd;
                if (!cmd) { return 250; }
                g.__doorCmd = null;
                const logs: string[] = [];
                const t0 = performance.now();
                const ok = await abi.Traversal.walkResilient(cmd.dest, { radius: cmd.radius, attempts: 6, timeoutMs: 90_000, log: (m: string) => logs.push(m) });
                g.__doorResult = { ok, ms: performance.now() - t0, end: abi.reader.worldTile(), logs };
            };
            return bot;
        };
        g.rs2b0t.runner.start(abi.registerScript({ name: 'DoorCrossSmokeBot', create: createBot }));
    });
    await page.waitForTimeout(1500);

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
        const sceneStepped = res.logs.some(l => l.includes('scene-stepping'));
        const inTime = res.ms <= PASS_MS;
        const pass = res.ok && onFar && handledDoor && inTime;
        console.log(`${pass ? 'PASS' : 'FAIL'} ${leg.name}: return=${res.ok} onFarTile=${onFar} doorHandled=${handledDoor} sceneStep=${sceneStepped} time=${secs}s (<=${PASS_MS / 1000}s: ${inTime}) end=${JSON.stringify(res.end)}`);
        if (!pass) {
            console.error(`--- walker log tail (${leg.name}) ---`);
            for (const l of res.logs.slice(-25)) { console.error(`  ${l}`); }
            if (!handledDoor) { console.error('  (no (3248,3411) line — the door may not have been on the path; check endpoints)'); }
            allPass = false;
            break;
        }
    }

    if (!allPass) { await fail('door-cross: a leg did not cross cleanly within 25s'); }
    console.log('PASS: 4/4 one-tile door crossings genuinely on the far side within 25s');
    process.exit(0);
} finally {
    await browser.close();
}
