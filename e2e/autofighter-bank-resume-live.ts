/** Live proof, AutoFighter finishes a bank run and goes back to fighting with the bank shut.
 *  Why: the bank side of the inventory has Deposit ops, not Eat, so a hurt bot with the booth still
 *  open spun on the sustain loop instead of healing. Empty pack plus banked food forces the trip. */

//   bun e2e/autofighter-bank-resume-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `af${Date.now().toString(36).slice(-5)}`;

const GUARD_SPOT = { x: 2661, z: 3306, level: 0 };
const ARDOUGNE_EAST_BANK = { x: 2655, z: 3283, level: 0 };
const FOOD_WITHDRAW = 5;
/** The bank should never be the reason the bot stands still for this long. */
const MAX_BANK_OPEN_MS = 60_000;
const RUN_MS = 600_000;

const COMBAT_SKILLS = ['attack', 'strength', 'defence', 'hitpoints'] as const;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ name: string | null; count: number }> };
        Skills: { xp(name: string): number };
        Bank: { isOpen(): boolean };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

const client = deployIsolatedClient(`af${Date.now().toString(36).slice(-6)}`);
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
        [{ debugName: 'trout', displayName: 'Trout', qty: 40 }],
        ARDOUGNE_EAST_BANK
    );
    await cheatQuiet(page, 'give rune_scimitar 1', 1200);
    if (!(await teleTo(page, GUARD_SPOT, 8, 30_000))) {
        fail(`could not reach the East Ardougne guard spot (${GUARD_SPOT.x},${GUARD_SPOT.z})`);
    }

    await setSettings(page, 'AutoFighter', {
        target: 'Guard',
        spot: 'Start position',
        leashRadius: 14,
        combatStyle: 'melee',
        meleeStyle: 'strength',
        foodWithdraw: FOOD_WITHDRAW,
        banking: 'Auto',
        buryBones: false,
        solveClues: false
    });

    const xpBefore = await page.evaluate(skills =>
        skills.reduce((n, s) => n + (globalThis as never as Api).__rs2b0t.Skills.xp(s), 0),
    [...COMBAT_SKILLS]);
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('AutoFighter');
        if (!meta) {
            throw new Error('AutoFighter not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('AutoFighter started with an empty pack and 40 trout banked, waiting for the trip and the resume');

    const deadline = Date.now() + RUN_MS;
    let bankOpenSince = 0;
    let longestBankOpen = 0;
    let restocked = false;
    let xpAtRestock = 0;
    let xpAfterRestock = 0;
    let logs: string[] = [];
    while (Date.now() < deadline) {
        const snap = await page.evaluate(skills => {
            const g = globalThis as never as Api;
            return {
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state,
                bankOpen: g.__rs2b0t.Bank.isOpen(),
                food: g.__rs2b0t.Inventory.items().filter(i => (i.name ?? '').toLowerCase() === 'trout').length,
                xp: skills.reduce((n, s) => n + g.__rs2b0t.Skills.xp(s), 0)
            };
        }, [...COMBAT_SKILLS]);
        logs = snap.logs;

        if (snap.bankOpen) {
            bankOpenSince = bankOpenSince === 0 ? Date.now() : bankOpenSince;
            longestBankOpen = Math.max(longestBankOpen, Date.now() - bankOpenSince);
        } else {
            bankOpenSince = 0;
        }
        if (longestBankOpen > MAX_BANK_OPEN_MS) {
            fail(`the bank stayed open ${Math.round(longestBankOpen / 1000)}s — the bot is stuck at the booth`);
        }

        if (!restocked && snap.food >= FOOD_WITHDRAW) {
            restocked = true;
            xpAtRestock = snap.xp;
            console.log(`restocked ${snap.food} trout, watching for combat to resume`);
        }
        if (restocked && !snap.bankOpen) {
            xpAfterRestock = Math.max(xpAfterRestock, snap.xp - xpAtRestock);
        }
        if (snap.state !== 'running') {
            fail(`script stopped early: ${logs.slice(-6).join(' | ')}`);
        }
        if (restocked && xpAfterRestock > 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    console.log('--- recent logs ---');
    for (const m of logs.slice(-20)) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/autofighter-bank-resume-live.png' });
    const finalOpen = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Bank.isOpen());
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (!logs.some(m => /BankRun triggered: out of food/i.test(m))) {
        fail(`the empty pack never triggered a bank run: ${logs.slice(-4).join(' | ')}`);
    }
    if (!restocked) {
        fail(`never carried ${FOOD_WITHDRAW} trout after ${RUN_MS / 1000}s`);
    }
    if (finalOpen) {
        fail('the bank is still open at the end of the run');
    }
    if (xpAfterRestock <= 0) {
        fail('restocked but gained no combat XP afterwards — the bot never resumed fighting');
    }
    const total = await page.evaluate(skills =>
        skills.reduce((n, s) => n + (globalThis as never as Api).__rs2b0t.Skills.xp(s), 0),
    [...COMBAT_SKILLS]);
    console.log(`PASS, banked and resumed: combat xp +${total - xpBefore} total, +${xpAfterRestock} after the trip, bank never open longer than ${Math.round(longestBankOpen / 1000)}s`);
} finally {
    client.cleanup();
    await browser.close();
}
