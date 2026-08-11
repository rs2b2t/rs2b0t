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
        const sections = Array.from(document.querySelectorAll('#bot-panel > .rs2b0t-section'));
        const status = sections.find(section => section.querySelector('.rs2b0t-section-title')?.textContent === 'status');
        return {
            banner: text('.rs2b0t-banner')[0] ?? '',
            rows,
            sectionTitles: sections.map(section => section.querySelector('.rs2b0t-section-title')?.textContent ?? ''),
            statusRows: status ? Array.from(status.querySelectorAll('.rs2b0t-key'), node => node.textContent ?? '') : [],
            tick: (globalThis as never as { rs2b0t: { host: { tickCount: number; tickMeanMs: number } } }).rs2b0t.host.tickCount
        };
    });

    if (panel.banner !== '') fail(`unexpected adapter banner: '${panel.banner}'`);
    console.log('banner: none (adapter healthy)');

    if (panel.sectionTitles.includes('chat')) fail('chat section is still present');
    const removedStatusRows = ['energy', 'nearby', 'tick'].filter(label => panel.statusRows.includes(label));
    if (removedStatusRows.length > 0) fail(`removed status rows are still present: ${removedStatusRows.join(', ')}`);

    const { state, player, tile, modals } = panel.rows;
    if (state !== 'ready (scene 2)') fail(`state row: '${state}'`);
    if (!/^\d+, \d+, \d+$/.test(tile)) fail(`tile row: '${tile}'`);
    if (!/^main -?\d+ \/ side -?\d+ \/ chat -?\d+$/.test(modals)) fail(`modals row: '${modals}'`);
    console.log(`panel: player='${player}' tile=(${tile}) modals='${modals}'`);

    const before = panel.tick;
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => (globalThis as never as { rs2b0t: { host: { tickCount: number } } }).rs2b0t.host.tickCount);
    if (after < before + 2) fail(`tick counter stalled: ${before} -> ${after}`);
    console.log(`ticks advanced ${before} -> ${after}`);

    type RunnerGlobal = { rs2b0t: { runner: { state: string; ctx: { log: { level: string; msg: string }[]; loopCount: number } | null }; host: { tickCount: number } } };
    const runnerState = (): Promise<string> => page.evaluate(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.state);
    const logLength = (): Promise<number> => page.evaluate(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.log.length ?? 0);

    // Any looping script is fine — used to exercise start/pause/resume/stop + paint.
    await startFromLibrary(page, 'Magic', 'AIO Teleport');
    await page.getByRole('button', { name: 'Start' }).click();

    await page.waitForFunction(() => (globalThis as never as RunnerGlobal).rs2b0t.runner.state === 'running', undefined, { timeout: 20000 });
    await page.waitForFunction(() => ((globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.log.length ?? 0) >= 1, undefined, { timeout: 20000 });
    console.log('AIO Teleport: looping and logging');

    await page.waitForFunction(
        () => {
            const overlay = document.getElementById('overlay') as HTMLCanvasElement;
            const pixels = overlay.getContext('2d')?.getImageData(0, 0, overlay.width, overlay.height).data;
            if (!pixels) return false;
            for (let alpha = 3; alpha < pixels.length; alpha += 4) {
                if (pixels[alpha] !== 0) return true;
            }
            return false;
        },
        undefined,
        { timeout: 10000 }
    ).catch(() => fail('overlay not painted while AIO Teleport running'));
    console.log('AIO Teleport: overlay painted');

    await page.screenshot({ path: 'out/e2e-smoke-runtime.png' });

    await page.getByRole('button', { name: 'Pause' }).click();
    if ((await runnerState()) !== 'paused') fail('pause did not take');
    const pausedLogLength = await logLength();
    const pausedLoops = await page.evaluate(
        () => (globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.loopCount ?? 0
    );
    await page.waitForTimeout(2500);
    if ((await logLength()) !== pausedLogLength) fail('script made progress while paused');
    const loopsWhilePaused = await page.evaluate(
        () => (globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.loopCount ?? 0
    );
    if (loopsWhilePaused !== pausedLoops) fail('script looped while paused');
    console.log('AIO Teleport: paused cleanly (no progress while paused)');

    await page.getByRole('button', { name: 'Resume' }).click();
    await page.waitForFunction(
        n => ((globalThis as never as RunnerGlobal).rs2b0t.runner.ctx?.loopCount ?? 0) > n,
        pausedLoops,
        { timeout: 15000 }
    );
    console.log('AIO Teleport: resumed');

    await page.getByRole('button', { name: 'Stop' }).click();
    await page.waitForFunction(() => (globalThis as never as { rs2b0t: { runner: { state: string } } }).rs2b0t.runner.state === 'stopped', undefined, { timeout: 10000 });
    console.log('AIO Teleport: stopped cleanly');

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
