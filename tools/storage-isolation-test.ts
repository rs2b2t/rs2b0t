// Per-instance storage isolation (GitHub #16). No game server needed — the
// storage layer (Credentials, SettingsStore) initializes on bundle load, so a
// statically-served bot.html is enough. Real-browser only: happy-dom does not
// model per-tab vs per-iframe sessionStorage.
//
//   Test A — credentials must not bleed across TABS (shared localStorage).
//   Test B — script params must not bleed across same-origin IFRAMES in one
//            tab (shared sessionStorage — exactly how the MultiBox runs bots).
//
// Prereq: `bun run build:bot` (serves out/ + public-bot/).
import { chromium, type Browser } from 'playwright-core';
import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

let failures = 0;
function check(cond: boolean, msg: string): void {
    console.log(`  ${cond ? 'ok  ' : 'FAIL'}: ${msg}`);
    if (!cond) failures++;
}

function resolveChrome(): string {
    if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
    try {
        const p = chromium.executablePath();
        if (p && existsSync(p)) return p;
    } catch { /* playwright-core without a bundled browser */ }
    const cache = join(process.env.HOME ?? '', '.cache/ms-playwright');
    for (const pat of ['chromium-*/chrome-linux*/chrome', 'chromium-*/chrome-mac*/Chromium.app/Contents/MacOS/Chromium']) {
        const hits = [...new Glob(pat).scanSync(cache)].sort().reverse();
        if (hits.length > 0) return join(cache, hits[0]);
    }
    fail('no Chromium found — set CHROME_BIN or run `bunx playwright install chromium`');
}

if (!existsSync(join(ROOT, 'out/botclient.js'))) {
    fail('out/botclient.js missing — run `bun run build:bot` first');
}

function serveArtifacts(): { base: string; stop: () => void } {
    const map = (path: string): string | null => {
        if (path === '/bot.html') return join(ROOT, 'public-bot/bot.html');
        if (path === '/multibox.html') return join(ROOT, 'public-bot/multibox.html');
        if (path.startsWith('/bot/')) return join(ROOT, 'out', path.slice('/bot/'.length));
        return null;
    };
    const server = Bun.serve({
        port: 0,
        async fetch(req) {
            const fp = map(new URL(req.url).pathname);
            if (!fp) return new Response('not found', { status: 404 });
            const f = Bun.file(fp);
            return (await f.exists()) ? new Response(f) : new Response('missing', { status: 404 });
        }
    });
    return { base: `http://localhost:${server.port}`, stop: () => server.stop(true) };
}

async function waitRs2b0t(target: { evaluate: (fn: () => unknown) => Promise<unknown> }): Promise<void> {
    for (let i = 0; i < 40; i++) {
        if (await target.evaluate(() => Boolean((globalThis as Record<string, unknown>).rs2b0t))) return;
        await new Promise(r => setTimeout(r, 250));
    }
    fail('window.rs2b0t never initialized');
}

const { base, stop } = serveArtifacts();
console.log(`serving built client at ${base}`);
const browser: Browser = await chromium.launch({
    executablePath: resolveChrome(),
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
});

try {
    // ---- Test A: credentials across two tabs (one context = shared localStorage) ----
    console.log('\n[A] credentials must be per-tab, not shared across tabs');
    const ctxA = await browser.newContext();
    const pA = await ctxA.newPage();
    const pB = await ctxA.newPage();
    await pA.goto(`${base}/bot.html`);
    await pB.goto(`${base}/bot.html`);
    await pA.waitForSelector('input[placeholder="username"]', { timeout: 20000 });
    await pB.waitForSelector('input[placeholder="username"]', { timeout: 20000 });

    const USER_A = 'alpha_acct';
    const USER_B = 'beta_acct';
    const saveCreds = async (p: typeof pA, u: string) => {
        await p.fill('input[placeholder="username"]', u);
        await p.fill('input[placeholder="password"]', 'pw');
        await p.getByRole('button', { name: 'Save' }).click();
    };
    await saveCreds(pA, USER_A);
    await saveCreds(pB, USER_B); // in the buggy build this clobbers the shared localStorage key

    // Reload tab A: the panel repopulates the username field from Credentials.get()
    // — i.e. exactly the account this tab would log in as ("screen says X").
    await pA.reload();
    await pA.waitForSelector('input[placeholder="username"]', { timeout: 20000 });
    const shownInA = await pA.inputValue('input[placeholder="username"]');
    const shownInB = await pB.inputValue('input[placeholder="username"]');
    console.log(`  tab A resolves account "${shownInA}" (want "${USER_A}"); tab B "${shownInB}"`);
    check(shownInA === USER_A, `tab A keeps its own account after tab B saved (got "${shownInA}")`);
    check(shownInB === USER_B, `tab B keeps its own account (got "${shownInB}")`);
    await ctxA.close();

    // ---- Test B: script params across two iframes in one tab (shared sessionStorage) ----
    console.log('\n[B] Fisher params must be per-instance, not shared across MultiBox iframes');
    const ctxB = await browser.newContext();
    const top = await ctxB.newPage();
    await top.goto(`${base}/bot.html?box=alpha`);
    await waitRs2b0t(top);
    await top.evaluate((src) => {
        const f = document.createElement('iframe');
        f.src = src;
        f.style.width = '400px';
        f.style.height = '300px';
        document.body.appendChild(f);
    }, `${base}/bot.html?box=beta`);
    await top.waitForFunction(() => {
        const f = Array.from(document.querySelectorAll('iframe')).find(i => i.src.includes('box=beta')) as HTMLIFrameElement | undefined;
        return Boolean((f?.contentWindow as unknown as { rs2b0t?: { settings?: unknown } })?.rs2b0t?.settings);
    }, undefined, { timeout: 20000 });
    const betaFrame = top.frames().find(f => f.url().includes('box=beta'));
    if (!betaFrame) fail('beta iframe not found');

    const SHARKS = 'Harpoon — sharks';
    const SHRIMP = 'Small net — shrimp/anchovy';
    type SettHook = { rs2b0t: { settings: { save(n: string, k: string, v: string): void; saved(n: string, k: string): string | undefined } } };
    await top.evaluate(v => (globalThis as unknown as SettHook).rs2b0t.settings.save('Fisher', 'fishMethod', v), SHARKS);
    await betaFrame.evaluate(v => (globalThis as unknown as SettHook).rs2b0t.settings.save('Fisher', 'fishMethod', v), SHRIMP);

    const readAlpha = await top.evaluate(() => (globalThis as unknown as SettHook).rs2b0t.settings.saved('Fisher', 'fishMethod'));
    const readBeta = await betaFrame.evaluate(() => (globalThis as unknown as SettHook).rs2b0t.settings.saved('Fisher', 'fishMethod'));
    console.log(`  box=alpha reads "${readAlpha}" (want "${SHARKS}")`);
    console.log(`  box=beta  reads "${readBeta}" (want "${SHRIMP}")`);
    check(readAlpha === SHARKS, `alpha keeps its own fishMethod (got "${readAlpha}")`);
    check(readBeta === SHRIMP, `beta keeps its own fishMethod (got "${readBeta}")`);
    await ctxB.close();

    if (failures > 0) fail(`${failures} isolation check(s) failed`);
    console.log('\nPASS');
} finally {
    await browser.close();
    stop();
}
