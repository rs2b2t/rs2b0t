import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 6 });
const username = rest[0] ?? `gd${Date.now().toString(36).slice(-6)}`;

const ANCHOR = { x: 3096, z: 3814 };
const TELE = '::tele 0,48,59,24,38';
const ITEMS = ['::~item rune_scimitar 1', '::~item antidragonbreathshield 1', '::~item lobster 15'];

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

    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) { await type(page, `::setstat ${s} 85`, 1200); }
    for (const cheat of ITEMS) { await type(page, cheat, 1500); }
    const held = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().map(i => i.name).filter(Boolean));
    console.log(`inventory: ${held.join(', ')}`);

    await type(page, TELE, 2000);
    const at = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    const dragons = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === 'Green dragon').length);
    console.log(`at ${at?.x},${at?.z} — ${dragons} green dragons in scene`);
    if (!at || Math.abs(at.x - ANCHOR.x) > 6 || Math.abs(at.z - ANCHOR.z) > 6) fail(`field tele failed (at ${at?.x},${at?.z})`);
    if (dragons === 0) fail('no green dragons in scene — wrong coords?');

    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:GreenDragon:combatStyle', 'melee');
        sessionStorage.setItem('rs2b0t:set:GreenDragon:weapon', 'Rune scimitar');
        sessionStorage.setItem('rs2b0t:set:GreenDragon:food', 'Lobster');
    });

    await startFromLibrary(page, 'Combat', 'GreenDragon');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`GreenDragon (melee) started, running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0, kills = 0, shieldOn = false, looted = 0, deaths = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(8000);
        const snap = await page.evaluate(() => {
            const g = (globalThis as never as Rs2b0t).rs2b0t;
            return {
                state: g.runner.state,
                log: (g.runner.ctx?.log ?? []).map(l => l.msg),
                pos: g.reader.worldTile(),
                shield: g.reader.equipment().some(e => e && e.name === 'Dragonfire shield')
            };
        });
        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot] ${line}`);
            if (/green dragon down/i.test(line)) kills++;
            if (/looted (dragon bones|dragonhide)/i.test(line)) looted++;
            if (/equipped Dragonfire shield/i.test(line)) shieldOn = true;
            if (/died! recovering/i.test(line)) deaths++;
        }
        lastLogged = snap.log.length;
        if (snap.shield) shieldOn = true;
        console.log(`  [poll] pos=${snap.pos?.x},${snap.pos?.z} shield=${snap.shield} kills=${kills} deaths=${deaths}`);
        if (snap.state === 'crashed') { await page.screenshot({ path: 'out/greendragon.png' }); fail('script crashed'); }
    }

    console.log(`--- result --- kills=${kills} bones/hide looted=${looted} shieldOn=${shieldOn} deaths=${deaths}`);
    if (!shieldOn) fail('anti-dragon shield never equipped');
    if (kills === 0) fail('no kills observed');
    if (deaths > 0) fail(`died ${deaths}x — dragonfire not being absorbed?`);
    console.log('PASS');
} finally {
    await browser.close();
}
