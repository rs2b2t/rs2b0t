import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const username = `hp${Date.now().toString(36).slice(-7)}`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { start(script: unknown): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
};

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };

    await page.goto(`${base}/rs2b0t/index.html`);
    await boot();
    console.log('client booted at /rs2b0t/');

    const host = await page.evaluate(() => window.location.host);
    const url = new URL(base);
    if (host !== url.host) fail(`served from '${host}', expected the game origin '${url.host}'`);
    console.log(`served same-origin: window.location.host = ${host}`);

    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) { ok = await login(); if (!ok) await page.waitForTimeout(3000); }
    if (!ok) fail('login failed — prod-target same-origin connection did not reach the local engine');
    console.log('logged in same-origin (prod target, no proxy)');

    const before = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length);
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ChickenKiller')); });
    await page.waitForFunction(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length > (n as number), before, { timeout: 30000 }).catch(() => {});
    const after = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length);
    if (after <= before) fail('bot produced no log output — client not fully live under /rs2b0t/');
    console.log('bot started and produced output under /rs2b0t/');

    console.log('PASS — hosted /rs2b0t/ client works same-origin (prod target, no proxy)');
} finally {
    await browser.close();
}
