// Live test for RockCrab's mage/range combat styles at the Rellekka field.
// Spawns the style's gear+consumables via cheats (the bank withdraw path is
// NOT exercised here — supplies start in the pack), injects the style
// settings, and asserts the style actually worked:
//   mage  — autocast armed (varp 108 = 3), kills logged, runes consumed.
//   range — kills logged, a mature ground stack collected (OBJ_COUNT reads).
//
// Usage: bun tools/rockcrab-style-test.ts <mage|range> [minutes] [base-url] [username]

import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 8 });
const style = rest[0];
if (style !== 'mage' && style !== 'range') {
    fail('usage: bun tools/rockcrab-style-test.ts <mage|range> [minutes] [base-url] [username]');
}
// 12-char username cap: 'm'/'r' + crab + 6 base36 chars = 11
const username = rest[1] ?? `${style === 'mage' ? 'm' : 'r'}crab${Date.now().toString(36).slice(-6)}`;

const TELE = '::tele 0,42,58,22,8'; // ~2710,3720, in the crab field
// staff of air + Wind Strike → only Mind runes consumed (air is free)
const MAGE_ITEMS = ['::~item staff_of_air 1', '::~item mindrune 200', '::~item lobster 10'];
const RANGE_ITEMS = ['::~item shortbow 1', '::~item bronze_arrow 150', '::~item lobster 10'];

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('first login failed');

    await type(page, '::tele 0,50,50,20,20', 1500);

    // relog #1: unlock the tutorial-locked sidebar tabs (cheats and the pack
    // reader only work properly once the tabs are unlocked)
    const relog = async (): Promise<void> => {
        await page.reload();
        await boot(page);
        let backIn = false;
        for (let i = 0; i < 8 && !backIn; i++) {
            await page.waitForTimeout(5000);
            backIn = await login(page, username);
        }
        if (!backIn) fail('re-login failed');
    };
    await relog();

    for (const s of ['defence', 'hitpoints', ...(style === 'mage' ? ['magic'] : ['ranged'])]) {
        await type(page, `::setstat ${s} 40`, 1500);
    }
    for (const cheat of style === 'mage' ? MAGE_ITEMS : RANGE_ITEMS) {
        await type(page, cheat, 1500);
    }

    // wield now, then relog #2: tutorial-skipped accounts never get the
    // equip-time combat-tab update (appearance.rs2 gates update_weapon_category
    // on tutorial progress) but login.rs2 runs it unconditionally — the second
    // login attaches the weapon's combat tab so autocast/styles work.
    const weaponName = style === 'mage' ? 'Staff of air' : 'Shortbow';
    const wielded = await page.evaluate(n => {
        const g = (globalThis as never as Rs2b0t).rs2b0t;
        const it = g.reader.inventory().find(i => i.name === n);
        if (!it) {
            return false;
        }
        const op = it.ops.findIndex(o => o !== null && /wield/i.test(o));
        return op !== -1 && g.router.driver.heldOp(it.id, it.slot, it.comId, op + 1) !== false;
    }, weaponName);
    if (!wielded) fail(`could not wield ${weaponName}`);
    await page.waitForTimeout(2000);
    await relog();

    await type(page, TELE, 1500);

    const atField = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().some(n => n.name === 'Rocks' || n.name === 'Rock Crab'));
    if (!atField) fail('no rock crabs in scene after teleport — wrong coords?');
    console.log(`at the rock crab field (${style})`);

    await page.evaluate(s => {
        localStorage.setItem('rs2b0t:set:RockCrab:combatStyle', s);
        localStorage.setItem('rs2b0t:set:RockCrab:solveClues', 'false');
        if (s === 'mage') {
            localStorage.setItem('rs2b0t:set:RockCrab:weapon', 'Staff of air');
            localStorage.setItem('rs2b0t:set:RockCrab:spell', 'Wind Strike');
        } else {
            localStorage.setItem('rs2b0t:set:RockCrab:weapon', 'Shortbow');
            localStorage.setItem('rs2b0t:set:RockCrab:ammo', 'Bronze arrow');
            localStorage.setItem('rs2b0t:set:RockCrab:collectAt', '8'); // mature quickly for the smoke window
        }
    }, style);

    const runesBefore = style === 'mage' ? await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(i => i.name === 'Mind rune').reduce((n, i) => n + i.count, 0)) : 0;

    await startFromLibrary(page, 'Combat', 'RockCrab');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`RockCrab (${style}) started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10000);
        const snap = await page.evaluate(() => {
            const g = (globalThis as never as Rs2b0t).rs2b0t;
            return { state: g.runner.state, log: (g.runner.ctx?.log ?? []).map(l => l.msg), tab0: g.reader.sideTabInterface(0), varp108: g.reader.varp(108) };
        });
        console.log(`  [state] combatTab=${snap.tab0} attackstyle_magic=${snap.varp108}`);
        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
        }
        lastLogged = snap.log.length;
        if (snap.state === 'crashed') {
            await page.screenshot({ path: `out/rockcrab-${style}-test.png` });
            fail('script crashed');
        }
    }

    await page.screenshot({ path: `out/rockcrab-${style}-test.png` });
    const end = await page.evaluate(() => {
        const g = (globalThis as never as Rs2b0t).rs2b0t;
        return {
            log: (g.runner.ctx?.log ?? []).map(l => l.msg),
            varp108: g.reader.varp(108),
            minds: g.reader.inventory().filter(i => i.name === 'Mind rune').reduce((n, i) => n + i.count, 0)
        };
    });
    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});

    const kills = end.log.filter(l => /rock crab down/.test(l)).length;
    console.log(`\nkills logged=${kills} (screenshot: out/rockcrab-${style}-test.png)`);
    if (kills === 0) fail('no kills logged');

    if (style === 'mage') {
        const armed = end.log.some(l => /autocast armed/.test(l));
        console.log(`autocast armed=${armed} (varp108=${end.varp108}), mind runes ${runesBefore} -> ${end.minds}`);
        if (!armed) fail('autocast never armed');
        if (end.varp108 !== 3) fail(`attackstyle_magic is ${end.varp108}, expected 3 (armed)`);
        if (end.minds >= runesBefore) fail('no runes consumed — kills were not casts');
    } else {
        const collected = end.log.filter(l => /collected a stack of/.test(l));
        console.log(`stack collections: ${collected.length}${collected.length ? ` (${collected[collected.length - 1]})` : ''}`);
        if (collected.length === 0) fail('never collected a mature arrow stack');
    }
    console.log('PASS');
} finally {
    await browser.close();
}
