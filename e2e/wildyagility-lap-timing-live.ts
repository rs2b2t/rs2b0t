/** Live speed proof for WildyAgility: time a fixed number of laps and report xp/hr.
 *  Why: the script's lap time is dominated by server animation, so a change is only worth shipping if
 *  it moves wall-clock. Counting `lap N complete` off the log ring times whole laps without depending on
 *  the craft pattern, and `cleared '<name>' in N ticks` gives the per-obstacle split so a regression can
 *  be attributed to one obstacle instead of the lap as a whole.
 *  Why: it starts standing on the course (north of the Gate) with food already in the pack, so the timed
 *  window covers laps only. The walk out and the ridge crossing happen before the clock starts.
 *  Speed is pinned to the standard 600ms tick because this is a wall-clock test. */

//   bun e2e/wildyagility-lap-timing-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `wl${Date.now().toString(36).slice(-5)}`;

/** Course start side, north of the Gate at 2998,3931 so the script is already inside the lap zone. */
const COURSE_INSIDE = { x: 3004, z: 3937, level: 0 };
const EDGEVILLE_BANK = { x: 3094, z: 3493, level: 0 };
const AGILITY = Number(process.env.AGILITY) || 52;
const LAPS_WANTED = Number(process.env.LAPS) || 10;
const FOOD = 'Lobster';
const RUN_MS = Number(process.env.RUN_MS) || 900_000;
/** Wall-clock budget for the timed window; fails a run that is slower than this, never faster. */
const LAP_MAX_MS = Number(process.env.LAP_MAX_MS) || Number.POSITIVE_INFINITY;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }> };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(reason: string): void;
            ctx: { log: { time?: number; level: string; msg: string }[] } | null;
        };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const client = deployIsolatedClient(`wl${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    // onStart refuses below Agility 52 (the ridge), so the run is unreachable without it.
    await cheatQuiet(page, `setstat agility ${AGILITY}`, 1200);
    await cheatQuiet(page, 'setstat hitpoints 99', 800);
    await clearChatDialogs(page, 'agility level-ups');
    await seedItemsToBank(page, [{ debugName: 'lobster', displayName: FOOD, qty: 28 }], EDGEVILLE_BANK);

    // Start on the course so the timed window is laps, not the walk out.
    if (!(await teleTo(page, COURSE_INSIDE, 4, 25_000))) {
        fail(`could not stand on the course at (${COURSE_INSIDE.x},${COURSE_INSIDE.z})`);
    }
    // A pack of food means no startup bank trip; the withdrawal happens before the clock starts.
    await setSettings(page, 'WildyAgility', {
        food: FOOD,
        foodWithdraw: 28,
        minFood: 0,
        acquireFoodAtStart: false,
        obstacleTimeoutTicks: 24
    });
    // ::speed mutates the engine's in-memory tick rate and it persists across sessions on this engine.
    await cheatQuiet(page, 'speed 600', 1500);

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('agility'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('WildyAgility');
        if (!meta) {
            throw new Error('WildyAgility not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`WildyAgility started on the course at Agility ${AGILITY} — timing ${LAPS_WANTED} laps`);

    // Count laps off the script's own `lap N complete` lines, with a watermark, so replaying the ring
    // cannot double count. The log ring is capped, so only new lines are processed.
    const deadline = Date.now() + RUN_MS;
    let processed = 0;
    let laps = 0;
    let firstLapAt = 0;
    let finishedAt = 0;
    let xpGained = 0;
    let deaths = 0;
    const tickSamples = new Map<string, number[]>();
    while (Date.now() < deadline && finishedAt === 0) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => ({ time: l.time ?? Date.now(), msg: l.msg })),
                xp: g.__rs2b0t.Skills.xp('agility'),
                tile: g.rs2b0t.reader.worldTile(),
            };
        });
        for (; processed < snap.logs.length; processed++) {
            const line = snap.logs[processed]!;
            const lap = /^lap (\d+) complete$/.exec(line.msg);
            if (lap) {
                laps++;
                if (firstLapAt === 0) {
                    firstLapAt = line.time;
                }
                console.log(`  lap ${lap[1]} at ${line.time - firstLapAt}ms into the timed window`);
                if (laps >= LAPS_WANTED) {
                    finishedAt = line.time;
                }
                continue;
            }
            const cleared = /^cleared '(.+)' in (\d+) ticks$/.exec(line.msg);
            if (cleared) {
                const name = cleared[1]!;
                const list = tickSamples.get(name) ?? [];
                list.push(Number(cleared[2]));
                tickSamples.set(name, list);
            }
            if (/died in the wilderness/.test(line.msg)) {
                deaths++;
            }
        }
        xpGained = Math.max(xpGained, snap.xp - xpBefore);
        if (snap.state !== 'running' && laps === 0) {
            fail(`script stopped before the first lap: ${snap.logs.slice(-6).map(l => l.msg).join(' | ')}`);
        }
        await page.waitForTimeout(1000);
    }

    const logs = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-25).map(l => l.msg));
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    if (laps === 0) {
        fail(`no lap completed in ${RUN_MS / 1000}s`);
    }
    // The timed window runs from the first completed lap, so a slow entry walk does not skew it.
    const windowMs = finishedAt - firstLapAt;
    const timedLaps = finishedAt > 0 ? LAPS_WANTED : laps;
    console.log(`timed ${timedLaps} laps in ${windowMs}ms (${(windowMs / timedLaps / 1000).toFixed(1)}s per lap), ${deaths} deaths`);
    console.log('per-obstacle clear ticks:');
    for (const [name, list] of tickSamples) {
        const avg = list.reduce((n, v) => n + v, 0) / list.length;
        console.log(`  ${name.padEnd(16)} avg ${avg.toFixed(1)}t over ${list.length} (${list.join(',')})`);
    }
    if (finishedAt > 0) {
        const xpHr = windowMs > 0 ? Math.round((xpGained / windowMs) * 3_600_000) : 0;
        console.log(`PASS, ${timedLaps} laps in ${windowMs}ms, xp/hr ${xpHr.toLocaleString('en-US')}, ${deaths} deaths`);
        if (windowMs / timedLaps > LAP_MAX_MS) {
            fail(`${(windowMs / timedLaps).toFixed(0)}ms/lap exceeds the ${LAP_MAX_MS}ms budget`);
        }
    } else {
        fail(`only ${laps}/${LAPS_WANTED} laps in ${RUN_MS / 1000}s; the run stalled`);
    }
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
} finally {
    client.cleanup();
    await browser.close();
}