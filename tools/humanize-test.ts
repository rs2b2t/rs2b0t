// Verifies the human-behaviour layer: the synthetic cursor trail renders on
// the overlay, run energy is actually engaged (drains on a web-walk), and a
// break withholds new loop iterations then resumes.
//
// Usage: bun tools/humanize-test.ts [base-url] [username]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
const username = process.argv[3] ?? `hum${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[]; loopCount: number } | null };
        reader: { energy(): number; runControls(): { onComId: number; offComId: number } | null };
        humanizer: { forceBreak(ms: number): void; onBreak(): boolean };
        vinput: { stream(): { t: number }[] };
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

    // synthetic mode so the virtual cursor + trail are active
    await page.goto(`${base}/bot.html?inputmode=synthetic`);
    await boot();
    if (!(await login())) fail('login failed');
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) fail('relogin failed');
    for (const s of ['attack', 'strength', 'defence', 'hitpoints']) await type(`::setstat ${s} 40`);
    console.log('logged in (synthetic mode), at Lumbridge');

    // run controls resolved?
    const rc = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.runControls());
    if (!rc) fail('run controls did not resolve (controls interface layout moved?)');
    console.log(`run controls resolved: on=${rc.onComId} off=${rc.offComId}`);

    const energy0 = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.energy());

    // RockCrab web-walks to Rellekka — a long run that drains energy
    await page.selectOption('.lcb-select', 'RockCrab');
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`RockCrab started (synthetic), energy ${energy0}% — walking to the field...`);

    // run should get enabled, and energy should drop as it runs
    const runEnabled = await page.waitForFunction(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).some(l => l.msg.includes('run enabled')), undefined, { timeout: 60000 }).then(() => true).catch(() => false);
    if (!runEnabled) fail('run was never enabled by the policy');
    console.log('run policy: enabled run');

    // cursor trail: synthetic stream should be producing move events, and the
    // overlay should have non-transparent trail pixels
    await page.waitForTimeout(4000);
    const streamLen = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.vinput.stream().length);
    if (streamLen < 20) fail(`virtual cursor barely moved (${streamLen} events) — trail would be empty`);
    const trailPixels = await page.evaluate(() => {
        const o = document.getElementById('overlay') as HTMLCanvasElement;
        const d = o.getContext('2d')!.getImageData(0, 0, o.width, o.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
    });
    if (trailPixels < 50) fail(`overlay has no cursor trail drawn (${trailPixels} px)`);
    console.log(`cursor trail: ${streamLen} cursor events, ${trailPixels} overlay px drawn`);
    await page.screenshot({ path: 'out/humanize-test.png' });

    // energy drained from running
    await page.waitForTimeout(8000);
    const energy1 = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.reader.energy());
    console.log(`run energy: ${energy0}% -> ${energy1}% (drained by running)`);
    if (energy1 >= energy0) fail('energy did not drain — run is not actually engaged server-side');

    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'stopped', undefined, { timeout: 10000 }).catch(() => {});

    // break gate: DebugBot has fast short loops, so loopCount cleanly shows
    // the gate withholding new iterations during a break, then resuming.
    await page.selectOption('.lcb-select', 'DebugBot');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForTimeout(6000); // let it tick a few loops
    const loopsBefore = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.ctx?.loopCount ?? 0);
    if (loopsBefore < 2) fail(`DebugBot not looping (${loopsBefore})`);

    await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.humanizer.forceBreak(7000));
    await page.waitForTimeout(5000);
    const onBreak = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.humanizer.onBreak());
    const loopsDuring = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.ctx?.loopCount ?? 0);
    if (!onBreak) fail('break did not register');
    if (loopsDuring > loopsBefore + 1) fail(`loops kept advancing during break (${loopsBefore}->${loopsDuring})`);
    console.log(`break: held loops at ${loopsBefore}->${loopsDuring} during break`);

    await page.waitForTimeout(6000);
    const loopsAfter = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.runner.ctx?.loopCount ?? 0);
    if (loopsAfter <= loopsDuring) fail('bot did not resume after the break');
    console.log(`break: resumed (loops ${loopsDuring}->${loopsAfter} after)`);

    await page.getByRole('button', { name: 'Stop' }).click().catch(() => {});
    console.log('\nscreenshot: out/humanize-test.png');
    console.log('PASS');
} finally {
    await browser.close();
}
