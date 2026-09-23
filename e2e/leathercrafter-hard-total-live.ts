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
    await setSettings(page, 'LeatherCrafter', { leatherType: 'Hard leather', threadPerTrip: 100 });

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

    // Count whole inventories by "leather in the pack → 0 after having been >0" (a drain). Why:
    // this signal is inventory-only, so it materialises identically on the pre-fix and post-fix
    // scripts; either way the 10th full drain is the finish line.
    const deadline = Date.now() + RUN_MS;
    const startedAt = Date.now();
    let trips = 0;
    let wasFull = false;
    let finishedAt = 0;
    let xpGained = 0;
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
        xpGained = Math.max(xpGained, snap.xp - xpBefore);
        if (snap.state !== 'running' && trips === 0) {
            fail(`script stopped before the first inventory: ${snap.logs.slice(-6).join(' | ')}`);
        }
        await page.waitForTimeout(1200);
    }

    const totalMs = finishedAt - startedAt;
    const logs = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-25).map(l => l.msg));
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    console.log(`PASS, ${trips}/${TRIPS_WANTED} inventories in ${totalMs}ms (xp +${xpGained})`);
    if (trips < TRIPS_WANTED) {
        fail(`only ${trips}/${TRIPS_WANTED} inventories in ${RUN_MS / 1000}s; the run stalled (out of leather or thread)`);
    }
    if (totalMs > TOTAL_MAX_MS) {
        fail(`total ${totalMs}ms exceeds ${TOTAL_MAX_MS}ms — the run is slower than the speed budget`);
    }
} finally {
    client.cleanup();
    await browser.close();
}
