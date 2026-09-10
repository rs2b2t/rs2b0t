/** Live proof that a pause/resume in the middle of a walk leaves ONE loop body running (#580 regression).
 *
 *  The bug: ScriptRunner.resume() cleared ctx.loopInFlight while the parked loop was still alive, so the
 *  scheduler launched a second body into the same WalkExecutor singleton and the two walks interleaved.
 *  Oracle: loopCount rises by one per loop body, so a resume that spawns a second body reads as +2. */

//   bun e2e/resume-loop-concurrency-live.ts [base] [minutes]
import { deployIsolatedClient, launchBrowser, positionalArgs } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

type RunnerAbi = {
    rs2b0t: {
        runner: { ctx: { loopInFlight: boolean; loopCount: number; waiters: unknown[] } | null; pause(): void; resume(): void };
    };
};

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const minutes = Number(process.env.MINUTES ?? args[1] ?? '8');
const user = args[2] ?? `rl${Date.now().toString(36).slice(-6)}`;

/** Lumbridge to Varrock: far enough that a walk holds the loop across a pause. */
const START = 'tele 0,50,50,20,20';
const DEST = { x: 3212, z: 3428, level: 0 };

const fail = (msg: string): never => {
    console.log(`FAIL: ${msg}`);
    process.exit(1);
};

const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await mainlandAccount(page, base, user, client.page);
    await cheatQuiet(page, 'speed 300');
    await cheatQuiet(page, START);
    await relog(page, user);
    await cheatQuiet(page, 'speed 300');
    await cheatQuiet(page, START);

    await page.evaluate(d => {
        sessionStorage.setItem('rs2b0t:set:WalkTo:destination', 'Map pick');
        sessionStorage.setItem('rs2b0t:set:WalkTo:customTile', `${d.x},${d.z},${d.level}`);
        sessionStorage.setItem('rs2b0t:set:WalkTo:arriveRadius', '3');
    }, DEST);
    await startScript(page, 'WalkTo');

    const snap = (): Promise<{ inFlight: boolean; count: number; waiters: number } | null> =>
        page.evaluate(() => {
            const ctx = (globalThis as never as RunnerAbi).rs2b0t.runner.ctx;
            return ctx ? { inFlight: ctx.loopInFlight, count: ctx.loopCount, waiters: ctx.waiters.length } : null;
        });

    // Wait for a loop body parked inside the walk: in flight, with a scheduler waiter holding it.
    const armDeadline = Date.now() + 90_000;
    let armed: { inFlight: boolean; count: number; waiters: number } | null = null;
    while (Date.now() < armDeadline) {
        await page.waitForTimeout(250);
        const s = await snap();
        if (s?.inFlight && s.waiters > 0) {
            armed = s;
            break;
        }
    }
    if (!armed) {
        fail('no loop body ever parked inside the walk — nothing to pause across');
    }
    console.log(`armed mid-walk: loopCount=${armed!.count} waiters=${armed!.waiters}`);

    await page.evaluate(() => (globalThis as never as RunnerAbi).rs2b0t.runner.pause());
    await page.waitForTimeout(1200);
    await page.evaluate(() => (globalThis as never as RunnerAbi).rs2b0t.runner.resume());
    console.log('paused and resumed mid-walk');

    // Why: one loop body has at most one Execution waiter outstanding, so two waiters is two bodies.
    const window = Date.now() + Math.min(30_000, minutes * 60_000);
    let peakWaiters = 0;
    let progressed = false;
    while (Date.now() < window) {
        await page.waitForTimeout(100);
        const s = await snap();
        if (!s) {
            continue;
        }
        peakWaiters = Math.max(peakWaiters, s.waiters);
        if (s.waiters >= 2) {
            fail(`${s.waiters} loop waiters at once — a second loop body ran on top of the parked one`);
        }
        if (s.count > armed!.count) {
            progressed = true;
        }
    }
    if (!progressed) {
        fail('the loop never completed an iteration after the resume — it did not come back');
    }

    console.log(`PASS (one loop body across the resume, peak waiters ${peakWaiters}, loopCount ${armed!.count} -> ${(await snap())!.count})`);
} finally {
    await browser.close();
    client.cleanup();
}
