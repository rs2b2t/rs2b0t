/** Live proof, WildyAgility stocks the exact food it was told to before it walks into the wilderness.
 *  Why: the old count was a substring test, so a bank holding chocolate cake read as a bank holding cake,
 *  and there was no startup restock at all. The bank here holds both, and only one of them may come back. */

//   bun e2e/wildyagility-food-startup-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `wa${Date.now().toString(36).slice(-5)}`;

const EDGEVILLE_BANK = { x: 3094, z: 3493, level: 0 };
/** Sits before Cake alphabetically and matches the old substring test, so a regression grabs it first. */
const DECOY = 'Chocolate cake';
const WANT_FOOD = 'Cake';
const FOOD_WITHDRAW = 5;
const RUN_MS = 300_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }> };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const client = deployIsolatedClient(`wa${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    // Why: onStart refuses to run below Agility 52, the ridge requirement, so the startup food trip is unreachable without it.
    await cheatQuiet(page, 'setstat agility 60', 1200);
    await clearChatDialogs(page, 'agility level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'chocolate_cake', displayName: DECOY, qty: 20 },
            { debugName: 'cake', displayName: WANT_FOOD, qty: 20 }
        ],
        EDGEVILLE_BANK
    );
    if (!(await teleTo(page, EDGEVILLE_BANK, 6, 25_000))) {
        fail(`could not reach the Edgeville bank stand (${EDGEVILLE_BANK.x},${EDGEVILLE_BANK.z})`);
    }

    await setSettings(page, 'WildyAgility', {
        food: WANT_FOOD,
        foodWithdraw: FOOD_WITHDRAW,
        minFood: 0,
        acquireFoodAtStart: true
    });

    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('WildyAgility');
        if (!meta) {
            throw new Error('WildyAgility not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`WildyAgility started empty-handed with '${WANT_FOOD}' and '${DECOY}' both banked`);

    const deadline = Date.now() + RUN_MS;
    let cake = 0;
    let decoy = 0;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(([want, bad]) => {
            const g = globalThis as never as Api;
            const inv = g.__rs2b0t.Inventory.items();
            const named = (n: string): number => inv.filter(i => (i.name ?? '').toLowerCase() === n.toLowerCase()).length;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                cake: named(want),
                decoy: named(bad)
            };
        }, [WANT_FOOD, DECOY] as const);
        logs = snap.logs;
        cake = snap.cake;
        decoy = snap.decoy;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
        }
        if (decoy > 0) {
            fail(`withdrew ${decoy} '${DECOY}' — the food match is still a substring test`);
        }
        if (cake >= FOOD_WITHDRAW) {
            break;
        }
        await page.waitForTimeout(1500);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/wildyagility-food-startup-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (cake < FOOD_WITHDRAW) {
        fail(`only ${cake} '${WANT_FOOD}' after ${RUN_MS / 1000}s — the startup bank trip never stocked up`);
    }
    console.log(`PASS, startup trip withdrew ${cake} '${WANT_FOOD}' and left every '${DECOY}' in the bank`);
} finally {
    client.cleanup();
    await browser.close();
}
