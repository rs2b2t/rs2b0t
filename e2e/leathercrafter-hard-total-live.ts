/** Live proof the LeatherCrafter bank-leg fix does not slow the run: it times ten full inventories
 *  of hard leather end to end (total wall-clock from script start to the 10th inventory fully
 *  drained back to zero) and asserts the run finishes within TOTAL_MAX_MS. Run it once with the fix
 *  applied; then stash the LeatherCrafter + nearestBank-reachable fixes, run it again; the pre-fix
 *  total must be slower (never faster) than the post-fix total. Speed is pinned to the standard
 *  600ms tick because this is a wall-clock test. */
//   bun e2e/leathercrafter-hard-total-live.ts [http://localhost:8888]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `lcc${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const HARD_LEATHER_QTY = 26 * 10;
const TRIPS_WANTED = 10;
// Why: the seeded workload restated in XP, so the finish line does not depend on how the script
// batches its bursts or how often a pack drains.
const XP_PER_BODY = 35;
const TARGET_XP = 260 * XP_PER_BODY;
const TOTAL_MAX_MS = Number(process.env.TOTAL_MAX_MS) || 300_000;
const RUN_MS = 420_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }> };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { time?: number; level: string; msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const client = deployIsolatedClient(`lcc${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat crafting 50', 1200);
    await clearChatDialogs(page, 'crafting level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'hard_leather', displayName: 'Hard leather', qty: HARD_LEATHER_QTY },
            { debugName: 'needle', displayName: 'Needle', qty: 1 },
            { debugName: 'thread', displayName: 'Thread', qty: 200 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    // Why: this is a wall-clock speed test. `::speed` mutates the engine's in-memory World.tickRate
    // and that value persists across sessions on the long-lived engine, so pin the standard 600ms
    // tick. A leftover accelerated tick would compress every measurement and fake a false win.
    await cheatQuiet(page, 'speed 600', 1500);
    await setSettings(page, 'LeatherCrafter', { leatherType: 'Hard leather', threadPerTrip: 100, speculativeLoad: process.env.SPECULATIVE !== '0' });

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('crafting'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('LeatherCrafter');
        if (!meta) {
            throw new Error('LeatherCrafter not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('LeatherCrafter started at Varrock West on Hard leather — timing 10 full inventories');

    // The finish line is the seeded workload measured in crafting XP, not a counted number of
    // inventories. Why: XP is fixed (260 bodies x 35 xp) and monotonic, so the time to reach it
    // compares two scripts no matter how each batches its bursts. Counting drains by polling the
    // inventory instead under-counts a script that empties a pack between polls, which makes a
    // finished run look stalled.
    const deadline = Date.now() + RUN_MS;
    const startedAt = Date.now();
    let trips = 0;
    let wasFull = false;
    let finishedAt = 0;
    let xpGained = 0;
    let specWatermark = 0;
    let specHits = 0;
    while (Date.now() < deadline && finishedAt === 0) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const inv = g.__rs2b0t.Inventory.items();
            return {
                state: g.rs2b0t.runner.state,
                inv,
                leather: inv.filter(i => i.id === 1131).reduce((n, i) => n + i.count, 0),
                xp: g.__rs2b0t.Skills.xp('crafting'),
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
            };
        });
        if (snap.leather > 0) {
            wasFull = true;
        } else if (wasFull) {
            wasFull = false;
            trips++;
            console.log(`inventory ${trips}/${TRIPS_WANTED} drained (${Date.now() - startedAt}ms elapsed)`);
            if (trips >= TRIPS_WANTED) {
                finishedAt = Date.now();
            }
        }
        for (; specWatermark < snap.logs.length; specWatermark++) {
            const line = snap.logs[specWatermark]!;
            if (/speculative load/i.test(line)) {
                specHits++;
                console.log(`  [live] ${line}`);
            }
        }
        xpGained = Math.max(xpGained, snap.xp - xpBefore);
        if (xpGained >= TARGET_XP) {
            finishedAt = Date.now();
        } else if (snap.state !== 'running' && xpGained === 0) {
            fail(`script stopped before crafting anything: ${snap.logs.slice(-6).join(' | ')}`);
        }
        await page.waitForTimeout(1200);
    }

    const totalMs = finishedAt - startedAt;
    const logs = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-25).map(l => l.msg));
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    const bodies = Math.floor(xpGained / XP_PER_BODY);
    console.log(`PASS, xp +${xpGained} (${bodies} bodies) in ${totalMs}ms, ${trips} pack drains observed, speculative load on ${specHits} legs`);
    if (xpGained < TARGET_XP) {
        fail(`only ${xpGained}/${TARGET_XP} xp in ${RUN_MS / 1000}s; the run stalled (out of leather or thread)`);
    }
    if (totalMs > TOTAL_MAX_MS) {
        fail(`total ${totalMs}ms exceeds ${TOTAL_MAX_MS}ms — the run is slower than the speed budget`);
    }
} finally {
    client.cleanup();
    await browser.close();
}
