/** Live benchmark, HerbCleaner with the instant bank leg on a stocked Varrock West bank.
 *  Why: cleaning throughput is dominated by the bank trip, so this reports herbs/min, trips and
 *  instant-leg hits instead of only proving the script runs. Requires the isolated client deploy. */

//   ENGINE_DIR=/home/shonc/rs2bot/Server/engine SECONDS=120 bun e2e/herbcleaner-bank-live.ts
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `hcb${Date.now().toString(36).slice(-5)}`;
const runMs = Number(process.env.SECONDS ?? 120) * 1000;

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
/** Enough that a 90-120s run measures throughput instead of emptying the bank. */
const BANKED_PER_HERB = 1200;

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
        [
            // Why: every unidentified herb is named 'Herb' in-game, so the seed verify counts by that and the bot works off the object id.
            { debugName: 'unidentified_guam', displayName: 'Herb', qty: BANKED_PER_HERB },
            { debugName: 'unidentified_marentill', displayName: 'Herb', qty: BANKED_PER_HERB }
        ],
        VARROCK_WEST_BANK
    );
    if (!(await teleTo(page, VARROCK_WEST_BANK, 6, 25_000))) {
        fail(`could not reach the Varrock West bank stand (${VARROCK_WEST_BANK.x},${VARROCK_WEST_BANK.z})`);
    }

    // Why: FAST_BANK=0 runs the same seed through the confirmed route so the benchmark has a baseline.
    const fastBank = process.env.FAST_BANK !== '0';
    await setSettings(page, 'HerbCleaner', { herbs: 'Guam leaf,Marrentill', fastBank });

    const xpBefore = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.xp('herblore'));
    const at = Date.now();
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('HerbCleaner');
        if (!meta) {
            throw new Error('HerbCleaner not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`HerbCleaner started on ${BANKED_PER_HERB} guam + ${BANKED_PER_HERB} marrentill for ${runMs / 1000}s`);

    const deadline = Date.now() + runMs;
    let logs: string[] = [];
    let state = 'running';
    let xp = xpBefore;
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
        state = snap.state;
        xp = snap.xp;
        if (state !== 'running') {
            break;
        }
        await page.waitForTimeout(1000);
    }

    const elapsed = (Date.now() - at) / 1000;
    const xpGained = xp - xpBefore;
    // Why: guam and marrentill give different XP, so the cleaned count comes from the trip logs, not the XP total.
    const cleaned = logs.reduce((sum, m) => {
        const took = /took (\d+) grimy/.exec(m);
        return sum + (took ? Number(took[1]) : 0);
    }, 0);
    const perMinute = cleaned / (elapsed / 60);
    const trips = logs.filter(m => m.startsWith('banked @')).length;
    const instant = logs.filter(m => m.startsWith('instant bank:')).length;
    const emptied = logs.some(m => /every selected herb is empty in the bank/i.test(m));

    console.log(`RESULT fast=${fastBank} elapsed=${elapsed.toFixed(1)}s cleaned=${cleaned} herbs/min=${perMinute.toFixed(0)} ` +
        `xp=${xpGained.toFixed(1)} trips=${trips} instant=${instant} state=${state} emptied=${emptied}`);

    if (state !== 'running' && !emptied) {
        fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
    }
    if (cleaned <= 0) {
        fail('no grimy herbs were cleaned');
    }
    if (fastBank && instant === 0) {
        fail('no instant bank legs — the fast pass never landed');
    }
    if (trips === 0) {
        fail('no completed bank trips');
    }
    await page.screenshot({ path: 'docs/e2e/herbcleaner-bank-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
} finally {
    client.cleanup();
    await browser.close();
}
