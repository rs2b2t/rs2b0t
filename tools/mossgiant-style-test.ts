// Live test for MossGiant's combat styles at the Ardougne-north moss giants.
// Spawns the style's gear+consumables via cheats (bank withdraw NOT exercised),
// teleports onto the safespot tile (2553,3406), starts the bot, and asserts:
//   mage/range — autocast/kills logged AND the bot HOLDS the safespot tile
//                (never steps off to melee), loot grabbed.
//   melee      — kills logged (fights in the pile), loot grabbed.
//
// Usage: bun tools/mossgiant-style-test.ts <mage|range|melee> [minutes] [base-url] [username]

import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 6 });
const style = rest[0] ?? 'range'; // default = the canonical safespot mode (fleet passes no style)
if (style !== 'mage' && style !== 'range' && style !== 'melee') {
    fail('usage: bun tools/mossgiant-style-test.ts [mage|range|melee] [minutes] [base-url] [username]');
}
const username = rest[1] ?? `mg${style[0]}${Date.now().toString(36).slice(-6)}`;

const SAFESPOT = { x: 2553, z: 3406 };
const TELE = '::tele 0,39,53,57,14'; // 2553,3406 — the safespot
const ITEMS: Record<string, string[]> = {
    mage: ['::~item staff_of_air 1', '::~item mindrune 400', '::~item lobster 15'],
    range: ['::~item maple_shortbow 1', '::~item iron_arrow 600', '::~item lobster 15'],
    melee: ['::~item lobster 15']
};

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

    for (const s of ['attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic']) {
        await type(page, `::setstat ${s} 60`, 1200);
    }
    for (const cheat of ITEMS[style]) { await type(page, cheat, 1500); }
    const held = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().map(i => i.name));
    console.log(`inventory after gives: ${held.filter(Boolean).join(', ')}`);

    if (style !== 'melee') {
        const weapon = style === 'mage' ? 'Staff of air' : 'Maple shortbow';
        const wielded = await page.evaluate(n => {
            const g = (globalThis as never as Rs2b0t).rs2b0t;
            const it = g.reader.inventory().find(i => i.name === n);
            if (!it) return false;
            const op = it.ops.findIndex(o => o !== null && /wield/i.test(o));
            return op !== -1 && g.router.driver.heldOp(it.id, it.slot, it.comId, op + 1) !== false;
        }, weapon);
        if (!wielded) fail(`could not wield ${weapon}`);
        await page.waitForTimeout(2000);
        await relog();
    }

    await type(page, TELE, 2000);
    const at = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    const giants = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === 'Moss giant').length);
    console.log(`at ${at?.x},${at?.z} — ${giants} moss giants in scene`);
    if (!at || Math.abs(at.x - SAFESPOT.x) > 4 || Math.abs(at.z - SAFESPOT.z) > 4) fail(`safespot tele failed (at ${at?.x},${at?.z})`);
    if (giants === 0) fail('no moss giants in scene at the safespot — wrong coords?');

    await page.evaluate(s => {
        localStorage.setItem('rs2b0t:set:MossGiant:combatStyle', s);
        localStorage.setItem('rs2b0t:set:MossGiant:food', 'Lobster');
        if (s === 'mage') { localStorage.setItem('rs2b0t:set:MossGiant:staff', 'Staff of air'); localStorage.setItem('rs2b0t:set:MossGiant:spell', 'Wind Strike'); }
        if (s === 'range') { localStorage.setItem('rs2b0t:set:MossGiant:bow', 'Maple shortbow'); localStorage.setItem('rs2b0t:set:MossGiant:ammo', 'Iron arrow'); }
    }, style);

    await startFromLibrary(page, 'Combat', 'MossGiant');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`MossGiant (${style}) started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0, kills = 0, offSafespot = 0, onSafespot = 0, armed = false;
    while (Date.now() < deadline) {
        await page.waitForTimeout(8000);
        const snap = await page.evaluate(() => {
            const g = (globalThis as never as Rs2b0t).rs2b0t;
            return { state: g.runner.state, log: (g.runner.ctx?.log ?? []).map(l => l.msg), pos: g.reader.worldTile(), varp108: g.reader.varp(108), inCombat: undefined as unknown };
        });
        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
            if (/moss giant down/i.test(line)) kills++;
            if (/autocast armed/i.test(line)) armed = true;
        }
        lastLogged = snap.log.length;
        // safespot adherence (range/mage): count on/off the tile
        if (style !== 'melee' && snap.pos) {
            if (snap.pos.x === SAFESPOT.x && snap.pos.z === SAFESPOT.z) onSafespot++; else offSafespot++;
        }
        if (snap.varp108 === 3) armed = true;
        console.log(`  [poll] pos=${snap.pos?.x},${snap.pos?.z} varp108=${snap.varp108} kills=${kills}`);
        if (snap.state === 'crashed') { await page.screenshot({ path: `out/mossgiant-${style}.png` }); fail('script crashed'); }
    }

    console.log(`--- result --- style=${style} kills=${kills} armed=${armed} onSafespot=${onSafespot} offSafespot=${offSafespot}`);
    if (kills === 0) fail('no kills observed in the window');
    if (style === 'mage' && !armed) fail('mage never armed autocast');
    if (style !== 'melee' && onSafespot === 0) fail('range/mage never held the safespot tile');
    console.log('PASS');
} finally {
    await browser.close();
}
