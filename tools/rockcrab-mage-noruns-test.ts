// Repro for "RockCrab mage gets stuck trying to set autocast when there are no
// runes." Spawns the mage staff + food but DELIBERATELY NO RUNES, starts the bot
// at the crab field, and asserts the fix: with castsLeft()==0 the ArmAutocast
// task now DEFERS (the engine's set_autocast_spell needs the runes in the pack,
// so arming can't take) and hands the loop to BankRun to restock runes — instead
// of spinning a futile "arming autocast" batch every loop.
//
// PASS: within the window the bot logs a BankRun restock ("banking"/"restocking"
// /"casts 0") and NEVER logs an autocast arm attempt while it holds no runes.
//
// Usage: bun tools/rockcrab-mage-noruns-test.ts [minutes] [base-url] [username]

import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 4 });
const username = rest[0] ?? `mcrabnr${Date.now().toString(36).slice(-5)}`;

const TELE = '::tele 0,42,58,22,8'; // ~2710,3720, in the crab field
// staff of air + food, but NO runes on purpose.
const ITEMS = ['::~item staff_of_air 1', '::~item lobster 10'];

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('first login failed');
    await type(page, '::tele 0,50,50,20,20', 1500);

    const relog = async (): Promise<void> => {
        await page.reload();
        await boot(page);
        let backIn = false;
        for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(page, username); }
        if (!backIn) fail('re-login failed');
    };
    await relog();

    for (const s of ['defence', 'hitpoints', 'magic']) { await type(page, `::setstat ${s} 40`, 1500); }
    for (const cheat of ITEMS) { await type(page, cheat, 1500); }

    // wield the staff, relog so the tutorial-skipped account attaches the staff
    // combat tab (staffTabAttached) — same dance as rockcrab-style-test.
    const wielded = await page.evaluate(() => {
        const g = (globalThis as never as Rs2b0t).rs2b0t;
        const it = g.reader.inventory().find(i => i.name === 'Staff of air');
        if (!it) { return false; }
        const op = it.ops.findIndex(o => o !== null && /wield/i.test(o));
        return op !== -1 && g.router.driver.heldOp(it.id, it.slot, it.comId, op + 1) !== false;
    });
    if (!wielded) fail('could not wield Staff of air');
    await page.waitForTimeout(2000);
    await relog();

    await type(page, TELE, 1500);
    const atField = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().some(n => n.name === 'Rocks' || n.name === 'Rock Crab'));
    if (!atField) fail('no rock crabs in scene after teleport');

    await page.evaluate(() => {
        localStorage.setItem('rs2b0t:set:RockCrab:combatStyle', 'mage');
        localStorage.setItem('rs2b0t:set:RockCrab:solveClues', 'false');
        localStorage.setItem('rs2b0t:set:RockCrab:weapon', 'Staff of air');
        localStorage.setItem('rs2b0t:set:RockCrab:spell', 'Wind Strike');
        localStorage.setItem('rs2b0t:set:RockCrab:food', 'Lobster');
    });

    const runes = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => i.name === 'Mind rune').reduce((n, i) => n + i.count, 0));
    console.log(`at field, mage, mind runes held: ${runes} (want 0)`);

    await startFromLibrary(page, 'Combat', 'RockCrab');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`RockCrab (mage, no runes) started, watching ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    let sawArmAttempt = false, sawBankRestock = false, sawArmed = false;
    while (Date.now() < deadline) {
        await page.waitForTimeout(8000);
        const snap = await page.evaluate(() => {
            const g = (globalThis as never as Rs2b0t).rs2b0t;
            return {
                state: g.runner.state,
                log: (g.runner.ctx?.log ?? []).map(l => l.msg),
                varp108: g.reader.varp(108),
                runes: g.reader.inventory().filter(i => i.name === 'Mind rune').reduce((n, i) => n + i.count, 0)
            };
        });
        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
            // an arm attempt WHILE holding no runes is the bug
            if (/arming autocast|could not arm autocast|autocast toggle did not|did not take/i.test(line) && snap.runes === 0) { sawArmAttempt = true; }
            if (/banking at|restocking|casts 0|bank can't supply|withdrew \d+ .*rune/i.test(line)) { sawBankRestock = true; }
            if (/autocast armed/i.test(line)) { sawArmed = true; }
        }
        lastLogged = snap.log.length;
        if (snap.state === 'crashed') { await page.screenshot({ path: 'out/rockcrab-mage-noruns.png' }); fail('script crashed'); }
        if (sawBankRestock) { break; } // BankRun took over — the point is proven
    }

    console.log(`--- result --- armAttemptWhileNoRunes=${sawArmAttempt} bankRestock=${sawBankRestock} armed=${sawArmed}`);
    if (sawArmAttempt) { fail('BUG: ArmAutocast tried to arm while holding no runes (should defer to BankRun)'); }
    if (!sawBankRestock) { fail('BankRun never took over to restock runes'); }
    console.log('PASS — no-runes mage deferred autocast and went to bank for runes');
} finally {
    await browser.close();
}
