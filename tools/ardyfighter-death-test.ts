import { boot, fail, launchBrowser, parseArgs } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 10 });
const username = `ap${Date.now().toString(36).slice(-7)}`;
const OVERRIDES = 'ArdyFighter.food=zzz-nothing&ArdyFighter.panicHp=85&ArdyFighter.restUntilHp=40&ArdyFighter.foodTarget=4';
const PAGE = `${base}/bot.html?${OVERRIDES}`;

const ANCHOR = { x: 2661, z: 3306 };
const BANK = { x: 2655, z: 3286 };
const UNLOCK_TELE = 'tele 0,50,50,20,20';
const ANCHOR_TELE = 'tele 0,41,51,37,42';

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

    await page.goto(PAGE); await boot(page);
    let firstIn = false;
    for (let i = 0; i < 3 && !firstIn; i++) firstIn = await login();
    if (!firstIn) fail('first login failed');
    await cheat(UNLOCK_TELE);
    await page.reload(); await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('re-login failed');
    for (const s of ['attack', 'strength', 'hitpoints']) await cheat(`advancestat ${s} 40`);
    await cheat('advancestat thieving 10');

    for (let i = 0; i < 3 && dist(await where(), ANCHOR) > 6; i++) { await cheat(ANCHOR_TELE); await page.waitForTimeout(1500); }
    const t0 = await where();
    if (dist(t0, ANCHOR) > 6) fail(`anchor tele never took — at ${t0?.x},${t0?.z}`);
    const guards = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().filter(n => n.name === 'Guard').length);
    console.log(`[geo] at ${t0?.x},${t0?.z}  guards=${guards}`);

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

    const deadline = Date.now() + minutes * 60_000;
    let lastLog = 0;
    let panicked = false;
    let leftSquare = false;
    let reachedBank = false;
    let bankEmptyWait = false;
    let returned = false;

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
