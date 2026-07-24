import { launchBrowser, startFromLibrary } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const username = process.argv[3] ?? `smoke${Date.now().toString(36).slice(-7)}`;
const password = process.argv[4] ?? 'test';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const browser = await launchBrowser();

try {
    const page = await browser.newPage();

    const pageErrors: string[] = [];
    const resourceNoise: string[] = [];
    page.on('pageerror', err => pageErrors.push(String(err)));
    page.on('console', msg => {
        if (msg.type() !== 'error') {
            return;
        }

        if (msg.text().includes('Failed to load resource')) {
            resourceNoise.push(msg.location().url || msg.text());
        } else {
            pageErrors.push(msg.text());
        }
    });

    await page.goto(`${base}/bot.html`);

    await page.waitForFunction(
        () => {
            const lcb = (globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t;
            return lcb !== undefined && lcb.client.constructor.loopCycle > 10;
        },
        undefined,
        { timeout: 60000 }
    );
    console.log('client booted, title loop running');

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
            chat: text('.rs2b0t-chat-line'),
            tick: (globalThis as never as { rs2b0t: { host: { tickCount: number; tickMeanMs: number } } }).rs2b0t.host.tickCount
        };
    });

    if (panel.banner !== '') fail(`unexpected adapter banner: '${panel.banner}'`);
    console.log('banner: none (adapter healthy)');

    const { state, player, tile, energy, nearby, tick } = panel.rows;
    if (state !== 'ingame') fail(`state row: '${state}'`);
    if (!/^\d+, \d+, \d+$/.test(tile)) fail(`tile row: '${tile}'`);
    if (!/^\d+% \/ \d+ kg$/.test(energy)) fail(`energy row: '${energy}'`);
    if (!/^\d+ players, \d+ npcs$/.test(nearby)) fail(`nearby row: '${nearby}'`);
    if (!/^[1-9]\d* \(\d+ms\)$/.test(tick)) fail(`tick row: '${tick}'`);
    console.log(`panel: player='${player}' tile=(${tile}) energy=${energy} nearby=${nearby} tick=${tick}`);

    console.log(`chat: ${panel.chat.join(' | ')}`);

    const before = panel.tick;
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => (globalThis as never as { rs2b0t: { host: { tickCount: number } } }).rs2b0t.host.tickCount);
    if (after < before + 2) fail(`tick counter stalled: ${before} -> ${after}`);
    console.log(`ticks advanced ${before} -> ${after}`);

    type RunnerGlobal = { rs2b0t: { runner: { state: string; ctx: { log: { level: string; msg: string }[]; loopCount: number } | null }; host: { tickCount: number } } };
    const runnerState = (): Promise<string> => page.evaluate(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.state);
    const logLength = (): Promise<number> => page.evaluate(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.log.length ?? 0);

    await startFromLibrary(page, 'Quest', 'QuestDashboard');
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
