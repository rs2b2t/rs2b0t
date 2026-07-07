// Slice 6 functional test: ChickenKiller forced into SYNTHETIC input mode
// via the additive `bot.html?inputmode=synthetic` page override (main.ts).
// Bootstrap mirrors woodcut-test: fresh account, ::tele off Tutorial Island
// to the Lumbridge east chicken pen, re-login to unlock tabs, run ~8min.
//
// Asserts:
//   - at least one full fight -> loot -> bury cycle ('buried bones' logged)
//   - zero 'synthetic-fail:' lines (no resolution failures, no silent
//     fallback — ADR-0003)
//   - telemetry from the VirtualInput ring buffer is human-shaped:
//     continuous move deltas (no teleports), varied inter-click intervals,
//     zero dead-center clicks. (Direct mode produces NO stream — that
//     contrast is the dataset label.)
//
// Usage: bun tools/synthetic-test.ts [minutes] [base-url] [username]

import { chromium } from 'playwright-core';

const minutes = parseFloat(process.argv[2] ?? '8');
const base = process.argv[3] ?? 'http://localhost:8888';
const username = process.argv[4] ?? `synth${Date.now().toString(36).slice(-7)}`;

// pen at world (3232, 3298) -> jagex coords 0,50,51,32,34
const TELE = '::tele 0,50,51,32,34';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

interface StreamStats {
    windowMs: number;
    moves: number;
    moveDelta: { p50: number; p95: number; max: number };
    clicks: number;
    interClickMs: { p50: number; p95: number };
    deadCenterPct: number;
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; sideIcon: number[]; login(u: string, p: string, r: boolean): Promise<void> };
        host: { tickCount: number };
        runner: { state: string; ctx: { log: { level: string; msg: string }[]; loopCount: number } | null };
        router: { activeMode: string };
        vinput: { stats(windowMs?: number): StreamStats; stream(): { t: number; x: number; y: number; e: string }[] };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();
    page.on('pageerror', err => console.log(`pageerror: ${err}`));

    const login = async () => {
        await page.evaluate(
            ([user, pass]) => {
                const { client } = (globalThis as never as Lcb).lcbuddy;
                client.loginUser = user;
                client.loginPass = pass;
                void client.login(user, pass, false);
            },
            [username, 'test']
        );
        return page
            .waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 12000 })
            .then(() => true)
            .catch(() => false);
    };

    const type = async (text: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(text, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1200);
    };

    const boot = async () => {
        await page.waitForFunction(() => (globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy !== undefined && (globalThis as never as { lcbuddy: { client: { constructor: { loopCycle: number } } } }).lcbuddy.client.constructor.loopCycle > 10, undefined, { timeout: 60000 });
    };

    await page.goto(`${base}/bot.html?inputmode=synthetic`);
    await boot();
    if (!(await login())) fail('first login failed');
    console.log(`logged in as '${username}'`);

    await type(TELE);

    await page.reload(); // preserves ?inputmode=synthetic
    await boot();
    let backIn = false;
    for (let attempt = 0; attempt < 8 && !backIn; attempt++) {
        await page.waitForTimeout(5000);
        backIn = await login();
    }
    if (!backIn) fail('re-login failed');

    const invTab = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.client.sideIcon[3] ?? -1) !== -1);
    if (!invTab) fail('sidebar tabs still locked after re-login');
    console.log('tabs unlocked');

    const mode = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.router.activeMode);
    if (mode !== 'synthetic') fail(`inputmode override did not take (activeMode=${mode})`);
    console.log('input mode forced synthetic');

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: /^Combat/ }).click();
    await page.locator('.lcb-library-card', { hasText: 'ChickenKiller' }).click();
    await page.waitForSelector('.lcb-modal-backdrop', { state: 'hidden', timeout: 5000 });
    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`ChickenKiller started (synthetic), running ${minutes}min...`);

    const deadline = Date.now() + minutes * 60_000;
    let lastLogged = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(10_000);

        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Lcb).lcbuddy;
            return { state: runner.state, log: runner.ctx?.log ?? [] };
        });

        for (const line of snap.log.slice(lastLogged)) {
            console.log(`  [bot:${line.level}] ${line.msg}`);
        }
        lastLogged = snap.log.length;

        if (snap.state === 'crashed') {
            await page.screenshot({ path: 'out/synthetic-test.png' });
            fail('script crashed — see log above');
        }
    }

    // telemetry over the trailing 2 minutes, before stopping the script
    const stats = await page.evaluate(() => (globalThis as never as Lcb).lcbuddy.vinput.stats(120_000));

    await page.screenshot({ path: 'out/synthetic-test.png' });

    const log = await page.evaluate(() => ((globalThis as never as Lcb).lcbuddy.runner.ctx?.log ?? []).map(l => l.msg));
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.runner.state === 'stopped', undefined, { timeout: 10000 }).catch(() => {});

    const buried = log.filter(l => l === 'buried bones').length;
    const synthFails = log.filter(l => l.includes('synthetic-fail'));

    console.log('\n--- synthetic telemetry (trailing 2min) ---');
    console.log(`moves sampled:        ${stats.moves}`);
    console.log(`move delta px:        p50 ${stats.moveDelta.p50.toFixed(1)}  p95 ${stats.moveDelta.p95.toFixed(1)}  max ${stats.moveDelta.max.toFixed(1)}`);
    console.log(`clicks:               ${stats.clicks}`);
    console.log(`inter-click ms:       p50 ${stats.interClickMs.p50.toFixed(0)}  p95 ${stats.interClickMs.p95.toFixed(0)}`);
    console.log(`dead-center clicks:   ${stats.deadCenterPct.toFixed(1)}%`);

    // gesture-quality counters (builds without them report n/a)
    const quality = await page.evaluate(() => {
        const lcb = (globalThis as never as Lcb).lcbuddy as unknown as { router: { driver: { gestureStats?: { gestures: number; firstTry: number; corrections: number; extraAttempts: number; failures: number } } }; vinput: { retargets?: number } };
        return { g: lcb.router.driver.gestureStats ?? null, retargets: lcb.vinput.retargets ?? null };
    });
    if (quality.g) {
        const g = quality.g;
        console.log(`gestures:             ${g.gestures} (first-try ${g.gestures ? ((g.firstTry / g.gestures) * 100).toFixed(1) : 0}%)`);
        console.log(`corrections:          ${g.corrections}  extra attempts: ${g.extraAttempts}  failures: ${g.failures}`);
        console.log(`mid-flight retargets: ${quality.retargets ?? 'n/a'}`);
    } else {
        console.log('gesture quality:      n/a (older build)');
    }
    console.log('-------------------------------------------');

    console.log(`\nresult: ${buried} bones buried over ${minutes}min, ${synthFails.length} synthetic failures (screenshot: out/synthetic-test.png)`);

    if (buried === 0) fail('no full fight->loot->bury cycle completed');

    // Transient resolution failures (occluded ground items, hover races) are
    // logged explicitly and recovered by the script's own retries — a human
    // misclicks occluded targets too. Short smoke runs must be perfect; long
    // soaks tolerate a low rate (~1 per 15min observed in practice: 3 over
    // 60min at ~700 gestures = 0.4%).
    const failBudget = Math.floor(minutes / 15);
    if (synthFails.length > failBudget) fail(`synthetic resolution failures (${synthFails.length} > budget ${failBudget}):\n  ${synthFails.join('\n  ')}`);
    if (synthFails.length > 0) console.log(`note: ${synthFails.length} recovered resolution failure(s) within budget ${failBudget}`);
    if (stats.moves < 200) fail(`synthetic stream too sparse (${stats.moves} move samples) — is the virtual cursor running?`);
    if (stats.moveDelta.max > 60) fail(`teleport in move stream (max delta ${stats.moveDelta.max.toFixed(1)}px)`);
    if (stats.clicks < 5) fail(`too few clicks in window (${stats.clicks})`);
    if (stats.interClickMs.p95 <= stats.interClickMs.p50) fail('inter-click intervals not varied');
    if (stats.deadCenterPct !== 0) fail(`${stats.deadCenterPct.toFixed(1)}% dead-center clicks (must be zero)`);

    console.log('PASS');
} finally {
    await browser.close();
}
