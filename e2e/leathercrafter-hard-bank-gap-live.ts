/** Live proof the LeatherCrafter bank leg is fast when standing at a booth.
 *  Why: the bank-leg pick used to run an A* to every shortlisted bank (commit #835 introduced
 *  `nearestBankReachable`), tens of seconds of serial worker search even at the booth. This run
 *  seeds 10 inventories of hard leather, fills the pack ten times, and times each "out of leather
 *  → bank opened" gap from the script's own timestamped log ring, failing if any gap is slow. */

//   bun e2e/leathercrafter-hard-bank-gap-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `lch${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
// 26 hard leather per trip (28 slots − needle − thread), ten full inventories.
const BANKED_HARD_LEATHER = 26 * 10;
const TRIPS_WANTED = 10;
// The slow pre-fix pick measured ~5.5s standing at the booth; the fast-path should keep every
// gap well under this even with the booth open + deposit + withdraw chatter in the same window.
const GAP_MAX_MS = Number(process.env.GAP_MAX_MS) || 5000;
const RUN_MS = 420_000;

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
    };
}

interface Gap {
    trip: number;
    fromMs: number;
    gapMs: number;
}

const client = deployIsolatedClient(`lch${Date.now().toString(36).slice(-6)}`);
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
            { debugName: 'hard_leather', displayName: 'Hard leather', qty: BANKED_HARD_LEATHER },
            { debugName: 'needle', displayName: 'Needle', qty: 1 },
            { debugName: 'thread', displayName: 'Thread', qty: 200 }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    // Why: this harness compares gaps against GAP_MAX_MS in wall-clock ms, and `::speed` mutates
    // the engine's in-memory World.tickRate, which persists across sessions on the long-lived
    // engine. Pin the standard 600ms tick rather than inherit an accelerated leftover.
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
    console.log('LeatherCrafter started at Varrock West on Hard leather — timing craft→bank gaps');

    // Wait for a bank-open event, then the next "out of leather" start, and pair them up.
    // Why: the log ring is capped at 500 lines and polled in full, so only process new lines
    // (a watermark index); replaying the same lines would re-arm and double-count gaps.
    const deadline = Date.now() + RUN_MS;
    const gaps: Gap[] = [];
    let processed = 0;
    let openSeen = 0;
    let armFrom: number | null = null;
    let xpGained = 0;
    while (Date.now() < deadline && gaps.length < TRIPS_WANTED) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const inv = g.__rs2b0t.Inventory.items();
            return {
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => ({
                    time: l.time ?? Date.now(),
                    msg: l.msg
                })),
                xp: g.__rs2b0t.Skills.xp('crafting'),
                bodies: inv.filter(i => i.id === 1131).reduce((n, i) => n + i.count, 0)
            };
        });
        for (; processed < snap.logs.length; processed++) {
            const line = snap.logs[processed]!;
            if (/^loop: out of leather or thread — banking/.test(line.msg)) {
                armFrom = line.time;
            } else if (/^bank leg: bank opened/.test(line.msg)) {
                openSeen++;
                if (armFrom !== null) {
                    gaps.push({ trip: gaps.length + 1, fromMs: armFrom, gapMs: line.time - armFrom });
                    armFrom = null;
                }
            }
        }
        if (snap.state !== 'running' && gaps.length === 0) {
            fail(
                `script stopped before the first bank: ${snap.logs
                    .slice(-6)
                    .map(l => l.msg)
                    .join(' | ')}`
            );
        }
        xpGained = snap.xp - xpBefore;
        await page.waitForTimeout(1500);
    }

    const logs = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-25).map(l => l.msg));
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    if (gaps.length === 0) {
        fail(`no bank-open observed in ${RUN_MS / 1000}s (${openSeen} opens; lag hid them?)`);
    }
    const worst = gaps.reduce((w, g) => (g.gapMs > w.gapMs ? g : w), gaps[0]!);
    console.log(`gaps: ${gaps.map(g => `${g.gapMs}ms`).join(', ')}`);
    console.log(`PASS, ${gaps.length}/${TRIPS_WANTED} bank trips (xp +${xpGained})`);
    if (gaps.length < TRIPS_WANTED) {
        fail(`only ${gaps.length} bank trips; the run likely stalled out of leather or thread`);
    }
    if (worst.gapMs > GAP_MAX_MS) {
        fail(`slowest craft→bank gap ${worst.gapMs}ms exceeds ${GAP_MAX_MS}ms — the bank pick is still expensive`);
    }
} finally {
    client.cleanup();
    await browser.close();
}
