// Browser smoke test for the bot client (Slice 1 exit criterion): boots
// bot.html in headless Chrome, logs in through the client's own login(),
// and asserts the panel mirrors live game state.
//
// Requires a running local Engine (docs/DEV.md) with the bot deployed
// (tools/deploy-local.sh) and Google Chrome installed.
//
// Usage: bun tools/e2e-smoke.ts [base-url] [username] [password]

import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:8888';
// default to a per-run name: fresh save, and immune to a lingering
// "already online" session from a previous run
const username = process.argv[3] ?? `smoke${Date.now().toString(36).slice(-7)}`;
const password = process.argv[4] ?? 'test';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

try {
    const page = await browser.newPage();

    const pageErrors: string[] = [];
    const resourceNoise: string[] = [];
    page.on('pageerror', err => pageErrors.push(String(err)));
    page.on('console', msg => {
        if (msg.type() !== 'error') {
            return;
        }

        // missing favicon / content-pack gaps 404 on the stock client too;
        // they are environment noise, not a bot-client regression
        if (msg.text().includes('Failed to load resource')) {
            resourceNoise.push(msg.location().url || msg.text());
        } else {
            pageErrors.push(msg.text());
        }
    });

    await page.goto(`${base}/bot.html`);

    // client booted and main loop running (maininit finished)
    await page.waitForFunction(
        () => {
            const lcb = (globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t;
            return lcb !== undefined && lcb.client.constructor.loopCycle > 10;
        },
        undefined,
        { timeout: 60000 }
    );
    console.log('client booted, title loop running');

    // log in through the client's own (unmangled) login path
    await page.evaluate(
        ([user, pass]) => {
            const { client } = (globalThis as never as { rs2b0t: { client: { loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> } } }).rs2b0t;
            client.loginUser = user;
            client.loginPass = pass;
            void client.login(user, pass, false);
        },
        [username, password]
    );

    try {
        await page.waitForFunction(
            () => {
                const { client } = (globalThis as never as { rs2b0t: { client: { ingame: boolean; sceneState: number } } }).rs2b0t;
                return client.ingame && client.sceneState === 2;
            },
            undefined,
            { timeout: 30000 }
        );
    } catch (err) {
        const mes = await page.evaluate(() => {
            const { client } = (globalThis as never as { rs2b0t: { client: { loginMes1: string; loginMes2: string } } }).rs2b0t;
            return `${client.loginMes1} / ${client.loginMes2}`;
        });
        fail(`login did not reach the game (server said: '${mes}'): ${err}`);
    }
    console.log(`logged in as '${username}', scene rendering`);

    // let a few server ticks flow
    await page.waitForTimeout(2500);

    const panel = await page.evaluate(() => {
        const text = (selector: string): string[] => Array.from(document.querySelectorAll(selector)).map(n => n.textContent ?? '');
        const rows: Record<string, string> = {};
        for (const node of Array.from(document.querySelectorAll('.rs2b0t-row'))) {
            const key = node.querySelector('.rs2b0t-key')?.textContent ?? '';
            rows[key] = node.querySelector('.rs2b0t-value')?.textContent ?? '';
        }
        return {
            banner: text('.rs2b0t-banner')[0] ?? '',
            rows,
            stats: text('.rs2b0t-stat-level'),
            chat: text('.rs2b0t-chat-line'),
            tick: (globalThis as never as { rs2b0t: { host: { tickCount: number; tickMeanMs: number } } }).rs2b0t.host.tickCount
        };
    });

    // healthy adapter now shows NO banner (it only appears on not-attached / self-test FAILED)
    if (panel.banner !== '') fail(`unexpected adapter banner: '${panel.banner}'`);
    console.log('banner: none (adapter healthy)');

    const { state, player, tile, energy, nearby, tick } = panel.rows;
    if (state !== 'ingame') fail(`state row: '${state}'`);
    if (!/^\d+, \d+, \d+$/.test(tile)) fail(`tile row: '${tile}'`);
    if (!/^\d+% \/ \d+ kg$/.test(energy)) fail(`energy row: '${energy}'`);
    if (!/^\d+ players, \d+ npcs$/.test(nearby)) fail(`nearby row: '${nearby}'`);
    if (!/^[1-9]\d* \(\d+ms\)$/.test(tick)) fail(`tick row: '${tick}'`);
    console.log(`panel: player='${player}' tile=(${tile}) energy=${energy} nearby=${nearby} tick=${tick}`);

    if (panel.stats.some(s => !/^\d+\/\d+$/.test(s))) fail(`stats not populated: ${panel.stats.join(' ')}`);
    console.log(`stats: ${panel.stats.length} skills populated (hp ${panel.stats[3]})`);
    console.log(`chat: ${panel.chat.join(' | ')}`);

    // tick counter must advance (~600ms cadence)
    const before = panel.tick;
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => (globalThis as never as { rs2b0t: { host: { tickCount: number } } }).rs2b0t.host.tickCount);
    if (after < before + 2) fail(`tick counter stalled: ${before} -> ${after}`);
    console.log(`ticks advanced ${before} -> ${after}`);

    // ---- Slice 2: script runtime ----
    type RunnerGlobal = { rs2b0t: { runner: { state: string; ctx: { log: { level: string; msg: string }[]; loopCount: number } | null }; host: { tickCount: number } } };
    const runnerState = (): Promise<string> => page.evaluate(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.state);
    const logLength = (): Promise<number> => page.evaluate(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.log.length ?? 0);

    await page.selectOption('.rs2b0t-select', 'QuestDashboard');
    await page.getByRole('button', { name: 'Start' }).click();

    await page.waitForFunction(() => ((globalThis as never as { rs2b0t: { runner: { ctx: { log: { msg: string }[] } | null } } }).rs2b0t.runner.ctx?.log ?? []).filter(l => l.msg.toLowerCase().includes('quest')).length >= 2, undefined, { timeout: 20000 });
    console.log('QuestDashboard: looping and logging');

    const overlayPainted = await page.evaluate(() => {
        const overlay = document.getElementById('overlay') as HTMLCanvasElement;
        return (overlay.getContext('2d')?.getImageData(10, 10, 1, 1).data[3] ?? 0) > 0;
    });
    if (!overlayPainted) fail('overlay not painted while QuestDashboard running');
    console.log('QuestDashboard: overlay painted');

    await page.screenshot({ path: 'out/e2e-smoke-runtime.png' });

    await page.getByRole('button', { name: 'Pause' }).click();
    if ((await runnerState()) !== 'paused') fail('pause did not take');
    const pausedLogLength = await logLength();
    await page.waitForTimeout(2500);
    if ((await logLength()) !== pausedLogLength) fail('script made progress while paused');
    console.log('QuestDashboard: paused cleanly (no progress while paused)');

    await page.getByRole('button', { name: 'Resume' }).click();
    await page.waitForFunction(len => ((globalThis as never as { rs2b0t: { runner: { ctx: { log: unknown[] } | null } } }).rs2b0t.runner.ctx?.log.length ?? 0) > len, pausedLogLength, { timeout: 15000 });
    console.log('QuestDashboard: resumed');

    // QuestDashboard has no onStop hook, so a clean stop is proven by the runner
    // reaching the 'stopped' state (the runner still tears down subscriptions).
    await page.getByRole('button', { name: 'Stop' }).click();
    await page.waitForFunction(() => (globalThis as never as { rs2b0t: { runner: { state: string } } }).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10000 });
    console.log('QuestDashboard: stopped cleanly');

    await page.screenshot({ path: 'out/e2e-smoke.png' });
    console.log('screenshots: out/e2e-smoke.png, out/e2e-smoke-runtime.png');

    if (resourceNoise.length > 0) {
        console.log(`note: ${resourceNoise.length} resource-load failures (also present on the stock client): ${resourceNoise.join(', ')}`);
    }

    const fatal = pageErrors.filter(e => !e.includes('AudioContext') && !e.includes('autoplay'));
    if (fatal.length > 0) fail(`page errors:\n${fatal.join('\n')}`);

    console.log('PASS');
} finally {
    await browser.close();
}
