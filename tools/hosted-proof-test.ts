// Local same-origin proof for the hosted /rs2b0t/ client (sub-project C).
//
// The client under /rs2b0t/ is built TARGET=prod (same-origin resolution + a
// baked login modulus). Serving it from the local engine and logging in proves
// the prod target resolves the WS host to the SERVING origin (no reverse proxy,
// no hardcoded w1.rs2b2t.com) and connects with the baked key — end to end,
// without touching production.
//
// Prereq: local engine running + the subtree staged with the LOCAL modulus:
//   cd ~/code/rs2b2t-engine && npm run quickstart
//   PROD_RSAN=<local modulus> ENGINE=~/code/rs2b2t-engine sh tools/pack-rs2b0t.sh
//
// Usage: bun tools/hosted-proof-test.ts [base-url]   (default http://localhost:8890)

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

    // served from the /rs2b0t/ subtree — same origin as the game engine.
    // The engine serves nested public files by exact path but does NOT
    // directory-index, so locally we hit index.html directly; in prod a
    // Caddyfile.game rewrite maps the clean /rs2b0t URL to /rs2b0t/index.html.
    await page.goto(`${base}/rs2b0t/index.html`);
    await boot();
    console.log('client booted at /rs2b0t/');

    // the page must be served from the game origin (not a proxy / different host)
    const host = await page.evaluate(() => window.location.host);
    const url = new URL(base);
    if (host !== url.host) fail(`served from '${host}', expected the game origin '${url.host}'`);
    console.log(`served same-origin: window.location.host = ${host}`);

    // login proves the prod target resolved the WS host to THIS origin and used
    // the baked key — a wrong host or key would fail against the local engine.
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) { ok = await login(); if (!ok) await page.waitForTimeout(3000); }
    if (!ok) fail('login failed — prod-target same-origin connection did not reach the local engine');
    console.log('logged in same-origin (prod target, no proxy)');

    // run a bot a few ticks to confirm the client is fully live under /rs2b0t/
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
