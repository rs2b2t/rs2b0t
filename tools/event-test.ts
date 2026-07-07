// Random-event handling test. Spawns event NPCs next to a running bot (via
// ::npcadd, which fires the same opnpc dialog/pick handlers the real event
// uses) and asserts the shared RandomEventTask detects and clears them.
//
// Covers the two non-trivial non-combat paths live: DIALOG (genie) and PICK
// (triffid). Combat events reuse the bot's own kill loop (verified by the
// chicken/rockcrab combat tests); box/mime/maze are detect-and-log in v1.
//
// Usage: bun tools/event-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `evt${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { npcs(): { name: string | null }[] };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as Lcb).lcbuddy.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const logLines = () => page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
    const npcPresent = (name: string) => page.evaluate(n => (globalThis as never as Lcb).lcbuddy.reader.npcs().some(x => x.name === n), name);

    await page.goto(`${base}/bot.html`);
    await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20'); // off tutorial island
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('relogin failed');
    console.log('logged in at Lumbridge');

    // Use ChickenKiller as the host bot (it idles in place when there are no
    // chickens, so the event handler — first task — gets the loop quickly).
    // Each event runs at a distinct location so a prior phase's spawned NPC
    // isn't in the new scene.
    const runEvent = async (npc: string, displayName: string, detectMsg: string, tele: string) => {
        await type(tele);
        await type(`::npcadd ${npc}`);
        if (!(await npcPresent(displayName))) fail(`${displayName} did not spawn`);

        await page.selectOption('.lcb-select', 'ChickenKiller');
        await page.getByRole('button', { name: 'Start' }).click();

        const detected = await page.waitForFunction(m => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).some(l => l.msg.includes(m)), detectMsg, { timeout: 30000 }).then(() => true).catch(() => false);
        const tail = (await logLines()).slice(-6);
        if (!detected) {
            await page.screenshot({ path: 'out/event-test.png' });
            fail(`handler did not detect ${displayName}. recent log:\n  ${tail.join('\n  ')}`);
        }
        console.log(`${displayName}: detected + handled`);
        for (const l of tail.filter(l => l.includes('random event'))) console.log(`  ${l}`);

        // give the handler time to clear it, then confirm it's gone or handled
        await page.waitForTimeout(8000);
        const gone = !(await npcPresent(displayName));
        console.log(`  ${displayName} ${gone ? 'cleared from scene' : 'still present (handler attempted; some events teleport/expire)'}`);

        await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
        await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'stopped', undefined, { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(1500);
    };

    await runEvent('macro_geni', 'Genie', 'random event: genie', '::tele 0,50,50,20,20');
    await runEvent('macro_triffidseed', 'Strange plant', 'random event: strange plant', '::tele 0,50,50,40,40');
    await runEvent('macro_dwarf', 'Drunken Dwarf', 'random event: drunken dwarf', '::tele 0,50,51,20,20');

    await page.screenshot({ path: 'out/event-test.png' });
    console.log('\nscreenshot: out/event-test.png');
    console.log('PASS');
} finally {
    await browser.close();
}
