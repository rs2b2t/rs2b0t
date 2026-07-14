// Panic-retreat / recovery verification for ArdyFighter (Task 6, behavior 5).
// Models tools/death-test.ts (fresh account, CLIENT_CHEAT packets, panel
// Browse->Combat->ArdyFighter->Start, poll runner log + reader) on the CURRENT
// `rs2b0t` debug global.
//
// Path verified: PANIC RETREAT (behavior 5). Override food to a pattern that
// matches no item (?ArdyFighter.food=zzz-nothing) so the bot can never eat or
// count a restock; leave defence at 1 so the market guards land hits; it drops
// below panicHp with zero food, and PanicRetreat must fire — leave the square,
// walk to the south bank, find the bank empty (fresh account), wait out regen
// to restUntilHp (already met, so instant), and walk back to the market. We
// assert that full round-trip end-to-end.
//
// (Death recovery — behavior 6 — is the alternative path: floor defence+hp
// mid-fight so a guard kills the bot, then DeathRecovery walks it back from the
// Lumbridge respawn. That leg is a long, nav-flaky Lumbridge->Ardougne cross-
// country walk; panic is the contained, deterministic path, so it is the one
// this harness drives. See tools/death-test.ts for the death-kill recipe.)
//
// Usage: bun tools/ardyfighter-death-test.ts [minutes] [base-url]
import { boot, fail, launchBrowser, parseArgs } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 10 });
const username = `ap${Date.now().toString(36).slice(-7)}`;
// food=zzz-nothing -> matches no item (foodCount always 0); panicHp=85 fires
// after ~7 damage on a 40-hp bar; restUntilHp=40 is already met at the panic
// point so the regen wait returns promptly and the bot walks back.
const OVERRIDES = 'ArdyFighter.food=zzz-nothing&ArdyFighter.panicHp=85&ArdyFighter.restUntilHp=40&ArdyFighter.foodTarget=4';
const PAGE = `${base}/bot.html?${OVERRIDES}`;

const ANCHOR = { x: 2661, z: 3306 };
const BANK = { x: 2655, z: 3286 }; // DEFAULT_BANK_STAND
const UNLOCK_TELE = 'tele 0,50,50,20,20';
const ANCHOR_TELE = 'tele 0,41,51,37,42'; // -> (2661,3306,0)

const browser = await launchBrowser();

try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 30000 }).then(() => true).catch(() => false);
    };
    const cheat = async (command: string, wait = 1200) => {
        const sent = await page.evaluate(cmd => {
            const c = (globalThis as never as Rs2b0t).rs2b0t.client;
            if (!c.ingame || !c.out) return false;
            c.out.p1Enc(224); c.out.p1(cmd.length + 1); c.out.pjstr(cmd);
            return true;
        }, command);
        if (!sent) fail(`cheat '::${command}' not sent — client not ingame`);
        await page.waitForTimeout(wait);
    };
    const where = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    const hp = () => page.evaluate(() => { const s = (globalThis as never as Rs2b0t).rs2b0t.reader.stat(3); return `${s.effective}/${s.base}`; });
    const dist = (t: { x: number; z: number } | null, p: { x: number; z: number }) => (t ? Math.max(Math.abs(t.x - p.x), Math.abs(t.z - p.z)) : 999);
    const status = () => page.evaluate(() => { const b = (globalThis as never as Rs2b0t).rs2b0t.runner.bot as Record<string, unknown> | null; return b ? String(b.status) : '?'; });
    const runnerState = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state);

    // --- bring-up ---------------------------------------------------------
    await page.goto(PAGE); await boot(page);
    let firstIn = false;
    for (let i = 0; i < 3 && !firstIn; i++) firstIn = await login();
    if (!firstIn) fail('first login failed');
    await cheat(UNLOCK_TELE);
    await page.reload(); await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('re-login failed');
    // raise offence + hp + thieving, but LEAVE defence at 1 so guards connect
    // and the bot bleeds down to the panic gate quickly (still 40 hp of buffer
    // between the panic point ~33 and death, so it panics long before dying)
    for (const s of ['attack', 'strength', 'hitpoints']) await cheat(`advancestat ${s} 40`);
    await cheat('advancestat thieving 10');

    for (let i = 0; i < 3 && dist(await where(), ANCHOR) > 6; i++) { await cheat(ANCHOR_TELE); await page.waitForTimeout(1500); }
    const t0 = await where();
    if (dist(t0, ANCHOR) > 6) fail(`anchor tele never took — at ${t0?.x},${t0?.z}`);
    const guards = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === 'Guard').length);
    console.log(`[geo] at ${t0?.x},${t0?.z}  guards=${guards}`);

    // --- start ArdyFighter (no food it can use) — retry the Browse modal --
    let started = false;
    for (let attempt = 0; attempt < 4 && !started; attempt++) {
        await page.getByRole('button', { name: 'Browse…' }).click().catch(() => {});
        await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        await page.getByRole('button', { name: /^Combat/ }).click().catch(() => {});
        await page.waitForTimeout(500);
        const card = page.locator('.rs2b0t-library-card', { hasText: 'ArdyFighter' });
        if (await card.count() > 0) {
            await card.first().click();
            await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 }).catch(() => {});
            await page.getByRole('button', { name: 'Start' }).click();
            started = true;
        } else {
            await page.keyboard.press('Escape').catch(() => {});
            await page.waitForTimeout(1000);
        }
    }
    if (!started) fail('could not find/start the ArdyFighter card in the Browse modal');
    console.log(`ArdyFighter started (overrides: ${OVERRIDES}) — fighting with no usable food, expecting a panic retreat`);

    // --- poll for the panic round-trip ------------------------------------
    const deadline = Date.now() + minutes * 60_000;
    let lastLog = 0;
    let panicked = false; // "panic retreat at ..." logged
    let leftSquare = false; // moved > 8 from the anchor toward the bank
    let reachedBank = false; // within 4 of the bank stand
    let bankEmptyWait = false; // "bank empty — waiting for regen" reached
    let returned = false; // back within 8 of the anchor AFTER panicking

    while (Date.now() < deadline) {
        await page.waitForTimeout(6000);
        if ((await runnerState()) === 'crashed') fail('runner state crashed');

        const log = await page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of log.slice(lastLog)) console.log(`  [bot] ${line}`);
        lastLog = log.length;

        const t = await where();
        const dA = dist(t, ANCHOR);
        const dB = dist(t, BANK);
        console.log(`  [diag] tile ${t ? `${t.x},${t.z}` : '?'}  dAnchor=${dA} dBank=${dB}  hp ${await hp()}  '${await status()}'`);

        if (!panicked && log.some(l => /panic retreat at/i.test(l))) { panicked = true; console.log('  >> PanicRetreat fired (low HP, zero usable food)'); }
        if (panicked && !leftSquare && dA > 8) { leftSquare = true; console.log('  >> left the market square, retreating'); }
        if (panicked && !reachedBank && dB <= 4) { reachedBank = true; console.log('  >> reached the south bank'); }
        if (!bankEmptyWait && log.some(l => /bank empty|waiting for regen/i.test(l))) { bankEmptyWait = true; console.log('  >> bank empty — withdrew nothing, regen-gated (already >= restUntilHp, returns promptly)'); }
        if (panicked && (reachedBank || bankEmptyWait) && dA <= 8) returned = true;

        if (panicked && reachedBank && returned) {
            console.log('\nresult summary (PANIC-RETREAT path):');
            console.log('  panic fired          : yes (HP below panicHp with no usable food)');
            console.log('  retreated to the bank: yes (reached the south-bank stand)');
            console.log(`  withdrew nothing     : ${bankEmptyWait ? 'yes (bank empty, regen-gated)' : 'bank opened, no matching food to withdraw'}`);
            console.log('  returned to market   : yes (back within 8 of the anchor)');
            console.log('\nverified path: PANIC RETREAT (behavior 5)');
            console.log('PASS');
            await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
            process.exit(0);
        }
    }

    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    fail(`panic round-trip did not complete — panicked=${panicked} reachedBank=${reachedBank} returned=${returned} (bankEmptyWait=${bankEmptyWait})`);
} finally {
    await browser.close();
}
