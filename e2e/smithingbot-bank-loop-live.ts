/** Live proof, SmithingBot runs the Varrock West bank → anvil → bank loop and goes back for bars it cannot use.
 *  Why: a Platebody costs five bars, so a 27-bar load leaves two behind; the bot must bank that remainder
 *  instead of reopening the anvil panel that forges nothing from it. */

//   bun e2e/smithingbot-bank-loop-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `sb${Date.now().toString(36).slice(-5)}`;

const BANK_STAND = { x: 3185, z: 3440, level: 0 };
const ANVIL_STAND = { x: 3188, z: 3425, level: 0 };
/** Not a multiple of five, so the last Platebody leaves a remainder the bot cannot smith. */
const BANKED_BARS = 54;
const BARS_PER_PLATEBODY = 5;
const RUN_MS = 480_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ name: string | null; count: number }>; used(): number };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const client = deployIsolatedClient(`sb${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat smithing 99', 1200);
    await clearChatDialogs(page, 'smithing level-ups');
    await seedItemsToBank(
        page,
        [{ debugName: 'bronze_bar', displayName: 'Bronze bar', qty: BANKED_BARS }],
        BANK_STAND
    );
    await cheatQuiet(page, 'give hammer 1', 1200);
    if (!(await teleTo(page, BANK_STAND, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${BANK_STAND.x},${BANK_STAND.z})`);
    }

    await setSettings(page, 'SmithingBot', {
        bar: 'Bronze',
        product: 'Platebody',
        anvilStand: `${ANVIL_STAND.x},${ANVIL_STAND.z}`,
        bankStand: `${BANK_STAND.x},${BANK_STAND.z}`,
        bankBooth: 'Bank booth',
        leashRadius: 6
    });

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('smithing'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('SmithingBot');
        if (!meta) {
            throw new Error('SmithingBot not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`SmithingBot started with ${BANKED_BARS} banked bars, watching for a second withdrawal`);

    const deadline = Date.now() + RUN_MS;
    let withdrawals = 0;
    let xpGained = 0;
    let leftoverSeen = 0;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                xp: g.__rs2b0t.Skills.xp('smithing'),
                bars: g.__rs2b0t.Inventory.items()
                    .filter(i => (i.name ?? '').toLowerCase().includes('bronze bar'))
                    .reduce((n, i) => n + Math.max(1, i.count), 0)
            };
        });
        withdrawals = snap.logs.filter(m => /withdrawing Bronze bar/i.test(m)).length;
        xpGained = snap.xp - xpBefore;
        if (snap.bars > 0 && snap.bars < BARS_PER_PLATEBODY) {
            leftoverSeen = Math.max(leftoverSeen, snap.bars);
        }
        if (snap.state !== 'running') {
            fail(`script stopped early: ${snap.logs.slice(-6).join(' | ')}`);
        }
        if (withdrawals >= 2 && xpGained > 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
    );
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/smithingbot-bank-loop-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (xpGained <= 0) {
        fail(`no smithing XP in ${RUN_MS / 1000}s — the bot never reached the anvil`);
    }
    if (withdrawals < 2) {
        fail(`only ${withdrawals} bar withdrawal(s) — the leftover ${leftoverSeen} bars never sent it back to the bank`);
    }
    console.log(`PASS, smithing xp +${xpGained}, ${withdrawals} bank withdrawals, leftover bars seen ${leftoverSeen}`);
} finally {
    client.cleanup();
    await browser.close();
}
