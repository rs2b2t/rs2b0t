/** Live proof, HerbCleaner cleans what the bank holds and stops once every selected herb is gone.
 *  Why: the withdraw failure for an absent herb used to be indistinguishable from a bank that had not
 *  loaded, so the trip loop retried forever. The run seeds one of the two chosen herbs and waits for the stop. */

//   bun e2e/herbcleaner-empty-bank-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `hc${Date.now().toString(36).slice(-5)}`;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
/** One trip's worth. Marrentill is selected too and never banked, so it is the herb that must get marked. */
const BANKED_GUAM = 20;
const RUN_MS = 420_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ id: number; name: string | null; count: number }> };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const client = deployIsolatedClient(`hc${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat herblore 20', 1200);
    await clearChatDialogs(page, 'herblore level-ups');
    await seedItemsToBank(
        page,
        // Why: every unidentified herb is named 'Herb' in-game, so the seed verify counts by that and the bot works off the object id.
        [{ debugName: 'unidentified_guam', displayName: 'Herb', qty: BANKED_GUAM }],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    await setSettings(page, 'HerbCleaner', { herbs: 'Guam leaf,Marrentill' });

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('herblore'));
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('HerbCleaner');
        if (!meta) {
            throw new Error('HerbCleaner not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`HerbCleaner started with ${BANKED_GUAM} guam banked and Marrentill selected but absent`);

    const deadline = Date.now() + RUN_MS;
    let xpGained = 0;
    let stopped = false;
    let markedMarrentill = false;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                xp: g.__rs2b0t.Skills.xp('herblore')
            };
        });
        logs = snap.logs;
        xpGained = snap.xp - xpBefore;
        markedMarrentill = markedMarrentill || logs.some(m => /Marrentill is empty in the bank/i.test(m));
        stopped = snap.state !== 'running';
        if (stopped) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/herbcleaner-empty-bank-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (xpGained <= 0) {
        fail(`no herblore XP in ${RUN_MS / 1000}s — the guam was never cleaned`);
    }
    if (!markedMarrentill) {
        fail('Marrentill was never marked empty, so the trip loop is still asking the bank for it');
    }
    if (!stopped) {
        fail(`still running after ${RUN_MS / 1000}s with an empty bank — the stop never fired`);
    }
    const reason = logs.find(m => /every selected herb is empty in the bank/i.test(m));
    if (!reason) {
        fail(`stopped for the wrong reason: ${logs.slice(-4).join(' | ')}`);
    }
    console.log(`PASS, herblore xp +${xpGained}, Marrentill marked empty, run stopped on an empty bank`);
} finally {
    client.cleanup();
    await browser.close();
}
