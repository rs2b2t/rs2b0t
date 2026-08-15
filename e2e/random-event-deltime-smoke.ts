/** Live smoke for fix/random-event-handler-crash — a deltime=0 mid-maze teleport must not crash ScriptRunner: [base].
 *  Repro path: running script → maze tele (scene rebuild, deltime briefly 0) → Supervisor/RandomEvents.detect → reader.npcs → combatShowing/deltimeNow. */

//   ~/redeploy.sh
//   bun e2e/random-event-deltime-smoke.ts [http://localhost:8890]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = process.argv[3] ?? `re${Date.now().toString(36).slice(-6)}`;

interface Api {
    __rs2b0t: {
        LoopingBot: new () => { loop(): Promise<void> };
        registerScript: (meta: { name: string; create: () => unknown }) => unknown;
        Execution: { delay(ms: number): Promise<void> };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
            ctx: { state: string; crashError?: { message: string } | null; log: { msg: string }[] } | null;
        };
        reader: {
            sceneState(): number;
            worldTile(): { x: number; z: number; level: number } | null;
        };
    };
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const logs: string[] = [];
function push(m: string): void {
    logs.push(m);
    console.log(m);
}

try {
    await page.goto(`${base}/bot.html`, { waitUntil: 'domcontentloaded' });
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    await page.waitForFunction(
        () => {
            const g = globalThis as never as Api;
            return g.rs2b0t?.reader?.sceneState?.() === 2 && g.rs2b0t?.reader?.worldTile?.() !== null;
        },
        undefined,
        { timeout: 120_000 }
    );
    push(`ingame as ${user}`);

    // Keep a ScriptRunner loop alive so RandomEvents is on the Supervisor path.
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const api = g.__rs2b0t;
        class IdlePulse extends api.LoopingBot {
            override async loop(): Promise<void> {
                await api.Execution.delay(600);
            }
        }
        g.rs2b0t.runner.start(api.registerScript({ name: 'ReDeltimeSmokeIdle', create: () => new IdlePulse() }));
    });
    await page.waitForFunction(
        () => (globalThis as never as Api).rs2b0t.runner.state === 'running',
        undefined,
        { timeout: 10_000 }
    );
    push('IdlePulse script running');

    // Maze mapzone — content [mapzone,0_45_71]; NW spawn tele used by random-events-live.
    await cheatQuiet(page, 'tele 0,45,71,11,53', 4000);
    await page.waitForFunction(
        () => {
            const t = (globalThis as never as Api).rs2b0t.reader.worldTile();
            return t !== null && t.x >> 6 === 45 && t.z >> 6 === 71;
        },
        undefined,
        { timeout: 30_000 }
    );
    push('in maze region — polling runner through deltime/scene rebuild');

    const deadline = Date.now() + 240_000;
    let leftMaze = false;
    let sawMazeSolved = false;
    let samples = 0;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const t = g.rs2b0t.reader.worldTile();
            const ctx = g.rs2b0t.runner.ctx;
            return {
                runnerState: g.rs2b0t.runner.state,
                ctxState: ctx?.state ?? null,
                crash: ctx?.crashError?.message ?? null,
                tip: ctx?.log?.slice(-8).map(l => l.msg) ?? [],
                inMaze: t !== null && t.x >> 6 === 45 && t.z >> 6 === 71,
                tile: t
            };
        });
        samples++;
        if (snap.runnerState === 'crashed' || snap.ctxState === 'crashed') {
            fail(`runner crashed during maze: ${snap.crash ?? '(no message)'} tips=${JSON.stringify(snap.tip)}`);
        }
        if (snap.tip.some(m => /maze solved/i.test(m))) {
            sawMazeSolved = true;
        }
        if (!snap.inMaze) {
            leftMaze = true;
            push(`left maze at ${snap.tile?.x},${snap.tile?.z} runner=${snap.runnerState}`);
            break;
        }
        await page.waitForTimeout(800);
    }

    if (!leftMaze) {
        fail('still inside maze after 240s');
    }

    // One more settle sample after exit (second crash window was post-solve tip).
    await page.waitForTimeout(1500);
    const final = await page.evaluate(() => {
        const g = globalThis as never as Api;
        const ctx = g.rs2b0t.runner.ctx;
        return {
            runnerState: g.rs2b0t.runner.state,
            ctxState: ctx?.state ?? null,
            crash: ctx?.crashError?.message ?? null,
            tips: ctx?.log?.slice(-12).map(l => l.msg) ?? []
        };
    });
    if (final.runnerState === 'crashed' || final.ctxState === 'crashed') {
        fail(`runner crashed after maze exit: ${final.crash ?? '(no message)'} tips=${JSON.stringify(final.tips)}`);
    }
    if (final.runnerState !== 'running' && final.ctxState !== 'running') {
        // Accept paused/stopping only if not crashed; idle means script ended cleanly.
        push(`WARN: runner state after maze is ${final.runnerState}/${final.ctxState} (ok if not crashed)`);
    }

    push(
        `PASS deltime-smoke samples=${samples} mazeSolvedLog=${sawMazeSolved} runner=${final.runnerState} ctx=${final.ctxState}`
    );
    console.log(JSON.stringify({ ok: true, samples, sawMazeSolved, final, logs: logs.slice(-20) }, null, 2));
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await page.evaluate(() => {
        try {
            (globalThis as never as Api).rs2b0t.runner.stop('harness stop');
        } catch {
            /* ignore */
        }
    }).catch(() => undefined);
    await browser.close();
}
