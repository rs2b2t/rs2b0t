/** Live check that AutoFighter keeps a rune reserve across a bank trip.
 *  Why: depositX has to leave the reserve in the pack and the shortfall has to come back from the bank. */

//   ENGINE_DIR=/path/to/engine bun e2e/autofighter-rune-reserve-live.ts [http://localhost:8888]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `afr${Date.now().toString(36).slice(-5)}`;

const ARDOUGNE_EAST_BANK = { x: 2655, z: 3283, level: 0 };
const FIGHT_SPOT = { x: 2661, z: 3306, level: 0 };
const KEEP = 5;
const FOOD_WITHDRAW = 5;
const RUN_MS = 180_000;

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;
const RUNES = ['Law rune', 'Air rune', 'Fire rune', 'Water rune', 'Earth rune'] as const;

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Bank: { isOpen(): boolean };
        Skills: { xp(name: string): number };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const client = deployIsolatedClient(`afr${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    for (const stat of COMBAT_SKILLS) {
        await cheatQuiet(page, `setstat ${stat} 50`, 700);
    }
    await clearChatDialogs(page, 'combat level-ups');
    await seedItemsToBank(
        page,
        [
            { debugName: 'trout', displayName: 'Trout', qty: 40 },
            { debugName: 'lawrune', displayName: 'Law rune', qty: 20 },
            { debugName: 'airrune', displayName: 'Air rune', qty: 20 },
            { debugName: 'firerune', displayName: 'Fire rune', qty: 20 },
            { debugName: 'waterrune', displayName: 'Water rune', qty: 20 },
            { debugName: 'earthrune', displayName: 'Earth rune', qty: 20 }
        ],
        ARDOUGNE_EAST_BANK
    );
    await cheatQuiet(page, 'give rune_scimitar 1', 1200);
    // Above the reserve for law, below it for air; fire/water/earth start empty.
    await cheatQuiet(page, 'give lawrune 10', 1200);
    await cheatQuiet(page, 'give airrune 2', 1200);
    if (!(await teleTo(page, FIGHT_SPOT, 8, 30_000))) {
        fail(`could not reach the fighting spot (${FIGHT_SPOT.x},${FIGHT_SPOT.z})`);
    }

    await setSettings(page, 'AutoFighter', {
        target: 'Guard',
        food: 'Trout',
        bankLocation: 'Nearest',
        spot: 'Start position',
        leashRadius: 14,
        combatStyle: 'melee',
        meleeStyle: 'strength',
        foodWithdraw: FOOD_WITHDRAW,
        banking: 'Auto',
        keepRunes: KEEP,
        buryBones: false,
        solveClues: false
    });

    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('AutoFighter');
        if (!meta) {
            throw new Error('AutoFighter not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log(`AutoFighter started; waiting for the first bank trip and a ${KEEP}-rune reserve`);

    const deadline = Date.now() + RUN_MS;
    let counts: Record<string, number> = {};
    let bankSeen = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                state: g.rs2b0t.runner.state,
                bank: g.__rs2b0t.Bank.isOpen(),
                counts: Object.fromEntries(
                    ['Trout', 'Law rune', 'Air rune', 'Fire rune', 'Water rune', 'Earth rune']
                        .map(name => [name, g.__rs2b0t.Inventory.count(name)])
                ),
                log: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg)
            };
        });
        counts = snap.counts;
        bankSeen ||= snap.bank;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${snap.log.slice(-6).join(' | ')}`);
        }
        if (bankSeen && !snap.bank && counts.Trout >= FOOD_WITHDRAW && RUNES.every(r => counts[r] >= KEEP)) {
            break;
        }
        await page.waitForTimeout(500);
    }

    console.log(`counts after the bank trip: ${JSON.stringify(counts)}`);
    const wrong = RUNES.filter(r => counts[r] !== KEEP);
    if (wrong.length > 0) {
        fail(`reserve should be ${KEEP} of each; off: ${wrong.map(r => `${r}=${counts[r]}`).join(', ')}`);
    }
    if (counts.Trout < FOOD_WITHDRAW) {
        fail(`food not restocked: ${counts.Trout}/${FOOD_WITHDRAW}`);
    }
    console.log(`PASS: kept ${KEEP} of each rune, including 5 excess law deposited and 3 air withdrawn`);
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
} finally {
    client.cleanup();
    await browser.close();
}
