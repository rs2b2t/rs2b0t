import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

export function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

export interface IsolatedClient {
    /** Page to open, e.g. `/bot-fa7k2j.html`. */
    page: string;
    /** Delete this run's copy of the client. */
    cleanup(): void;
}

// Why: `bot.html` hardcodes one bundle path, so every session that deploys into `public/bot/` overwrites the others and the last writer decides what everyone runs.
// Why: a copy per run under its own directory costs a few megabytes and removes the race rather than detecting it — the client is served by the engine either way, so the origin, the websocket and the asset stream are unchanged.

/**
 * Deploy this run's own client next to the engine's, and return the page that loads it.
 * @see docs/decisions/quest-pitfalls-3.md
 */
export function deployIsolatedClient(tag: string, engineDir = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`): IsolatedClient {
    const publicDir = `${engineDir}/public`;
    const shared = `${publicDir}/bot.html`;
    if (!existsSync(shared)) {
        fail(`deploy: ${shared} not found — set ENGINE_DIR to the engine serving this run`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    // Why: `build:bot` does not bake the collision pack, and without it every Navigator dies on boot and walking degrades in silence to the scene stepper.
    if (!existsSync('out/collision.lcnav.gz')) {
        fail('deploy: out/collision.lcnav.gz missing — run tools/nav/build-collision.ts first');
    }

    const dir = `${publicDir}/bot/${tag}`;
    const html = `${publicDir}/bot-${tag}.html`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync('out', dir, { recursive: true });

    const rewritten = readFileSync(shared, 'utf8').replaceAll('./bot/botclient.js', `./bot/${tag}/botclient.js`);
    if (!rewritten.includes(`./bot/${tag}/botclient.js`)) {
        fail(`deploy: ${shared} does not reference ./bot/botclient.js — the rewrite matched nothing`);
    }
    writeFileSync(html, rewritten);
    console.log(`deploy: this run's client at /bot/${tag}/ served by /bot-${tag}.html`);

    return {
        page: `/bot-${tag}.html`,
        cleanup: () => {
            rmSync(dir, { recursive: true, force: true });
            rmSync(html, { force: true });
        }
    };
}

/** Flags that consume the argument after them. Their values are not positionals. */
const VALUE_FLAGS = new Set(['--base', '--minutes', '--stage', '--engine']);

/** Positional argv for harnesses that index their arguments: `--base` first, then a positional URL, then `fallbackBase`.
 *  Why: the e2e runner appends global flags (`--no-deploy`) to every harness, so raw `process.argv[2]` indexing reads a flag as the engine base. */
export function positionalArgs(argv: string[], fallbackBase: string): string[] {
    let flagBase: string | undefined;
    const bare: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (VALUE_FLAGS.has(a)) {
            if (a === '--base' && i + 1 < argv.length) flagBase = argv[i + 1];
            i++;
            continue;
        }
        if (a.startsWith('-')) continue;
        bare.push(a);
    }
    const positionalBase = bare[0]?.includes('://') ? bare.shift() : undefined;
    return [flagBase ?? positionalBase ?? fallbackBase, ...bare];
}

export function parseArgs(argv: string[], defaults?: { base?: string; minutes?: number }): { base: string; minutes: number; rest: string[] } {
    let base: string | undefined;
    let minutes: number | undefined;
    const rest: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--base' && i + 1 < argv.length) { base = argv[++i]; continue; }
        if (a === '--minutes' && i + 1 < argv.length) { const v = Number(argv[++i]); if (Number.isFinite(v)) { minutes = v; } continue; }
        if (a.startsWith('http') || a.includes('://')) { base = a; continue; }
        const n = Number(a);
        if (a.trim() !== '' && Number.isFinite(n)) { minutes = n; continue; }
        // rest is a scenario filter; the runner's global flags must never land in it
        if (a.startsWith('-')) continue;
        rest.push(a);
    }
    return {
        base: base ?? defaults?.base ?? 'http://localhost:8890',
        minutes: minutes ?? defaults?.minutes ?? 0,
        rest
    };
}

/** Preferred Playwright viewport for live harnesses; matches Playwright's own default for `browser.newPage()`.
 *  Why: bot.html scales the 765×503 game stage to fill the page, so forcing `{ width: 1500, height: 1000 }` blows the client up next to the smaller harnesses — omit `setViewportSize`/`viewport` or pass `HARNESS_VIEWPORT`. */
export const HARNESS_VIEWPORT = { width: 1280, height: 720 } as const;

export async function launchBrowser(opts?: { swiftshader?: boolean }): Promise<Browser> {
    // HEADED=1 opens a visible window (slowed down) so a human can watch/diagnose.
    const headed = !!process.env.HEADED;
    const slowMo = headed ? Number(process.env.SLOWMO ?? 200) : 0;
    if (opts?.swiftshader) {
        // software WebGL so the scene renders headless (no window, no GPU)
        const mac = process.platform === 'darwin';
        return chromium.launch({
            ...(mac ? { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } : { channel: 'chrome' }),
            headless: !headed,
            slowMo,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
        });
    }
    return chromium.launch({ channel: 'chrome', headless: !headed, slowMo });
}

/** Cold Playwright profile often spends minutes downloading jag/ondemand assets. */
const BOOT_MS = Number(process.env.BOOT_MS) || 180_000;
const LOGIN_MS = Number(process.env.LOGIN_MS) || 120_000;

export function boot(page: Page): Promise<unknown> {
    return page.waitForFunction(
        () =>
            ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client
                .constructor.loopCycle ?? 0) > 10,
        undefined,
        { timeout: BOOT_MS }
    );
}

export async function login(page: Page, user: string, pass = 'test'): Promise<boolean> {
    await page.evaluate(([u, p]) => {
        const c = (globalThis as never as Rs2b0t).rs2b0t.client;
        c.loginUser = u;
        c.loginPass = p;
        void c.login(u, p, false);
    }, [user, pass]);
    return page
        .waitForFunction(
            () =>
                (globalThis as never as Rs2b0t).rs2b0t.client.ingame &&
                (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2,
            undefined,
            { timeout: LOGIN_MS }
        )
        .then(() => true)
        .catch(() => false);
}

/**
 * Send a client cheat packet (CLIENT_CHEAT / op 224) without keyboard focus.
 * `command` is the text after `::` — e.g. `tele 0,50,50,20,20`.
 */
export async function cheatQuiet(page: Page, command: string, waitMs = 700): Promise<boolean> {
    const sent = await page.evaluate(c => {
        const client = (globalThis as never as Rs2b0t).rs2b0t?.client;
        if (!client?.ingame || !client.out) {
            return false;
        }
        client.out.p1Enc(224); // ClientProt.CLIENT_CHEAT
        client.out.p1(c.length + 1);
        client.out.pjstr(c);
        return true;
    }, command);
    await page.waitForTimeout(waitMs);
    return sent;
}

/** logout:try_logout — if_button com 2458 → ClientProt.IF_BUTTON (opcode 9) → p_logout.
 *  Tab-rooted, so the engine accepts it without the logout tab open; ~seconds against 60s for a socket drop. */
export const LOGOUT_BUTTON_COM = 2458;

/** Log out through the game's own button rather than by dropping the socket.
 *  Why: reloading the page leaves the server holding the player online for its disconnect grace period, which costs a relogin loop minutes. */
export async function logout(page: Page, waitMs = 8000): Promise<boolean> {
    const sent = await page.evaluate(com => {
        const a = (globalThis as never as { rs2b0t?: { actions?: { ifButton?(c: number): boolean } } }).rs2b0t?.actions;
        return a?.ifButton?.(com) ?? false;
    }, LOGOUT_BUTTON_COM);
    if (!sent) {
        return false;
    }
    return page
        .waitForFunction(() => !(globalThis as never as Rs2b0t).rs2b0t.client.ingame, undefined, { timeout: waitMs })
        .then(() => true)
        .catch(() => false);
}

export async function type(page: Page, text: string, waitMs?: number): Promise<void> {
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(400);
    await page.keyboard.type(text, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(waitMs ?? 1400);
}

const OFF_ISLAND_TELE = '::tele 0,50,50,20,20';

export async function bringUpOffIsland(page: Page, opts: { user: string; typeWaitMs?: number }): Promise<void> {
    await type(page, OFF_ISLAND_TELE, opts.typeWaitMs);
    await page.reload();
    await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(page, opts.user); }
    if (!backIn) { fail('relogin failed'); }
}

export async function stopScript(page: Page): Promise<void> {
    await page.evaluate(() => {
        try { (globalThis as never as Rs2b0t).rs2b0t.runner.stop('harness stopScript()'); } catch { /* ignore */ }
    });
    await page.waitForTimeout(400);
}

export async function setSettings(page: Page, script: string, map: Record<string, string | number | boolean>): Promise<void> {
    await page.evaluate(([name, entries]) => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:${name}:${k}`, String(v));
            try { localStorage.setItem(`rs2b0t:set:${name}:${k}`, String(v)); } catch { /* private mode */ }
        }
    }, [script, map] as const);
}

export async function startFromLibrary(page: Page, category: string, script: string): Promise<void> {
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: new RegExp(`^${category}`) }).click();
    await page.locator('.rs2b0t-library-card', { hasText: script }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
}

export type Rs2b0t = {
    rs2b0t: {
        client: {
            ingame: boolean;
            sceneState: number;
            loginUser: string;
            loginPass: string;
            sideIcon: number[];
            loginMessage?: string;
            stream?: { close(): void } | null;
            out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } | null;
            login(u: string, p: string, r: boolean): Promise<void>;
            logout?(): Promise<void>;
        };
        host: { tickCount: number };
        runner: {
            state: string;
            ctx: { log: { level: string; msg: string }[]; loopCount: number } | null;
            bot: Record<string, unknown> | null;
            start(script: unknown): void;
            stop(reason: string): void;
        };
        reader: {
            inventory(): { name: string | null; count: number; id: number; slot: number; comId: number; ops: (string | null)[] }[];
            equipment(): { name: string | null; count: number }[];
            npcs(): { name: string | null; health: number; totalHealth: number; inCombat: boolean; distance: number; ops: (string | null)[]; tile: { x: number; z: number } }[];
            locs(): { name: string | null; ops: (string | null)[]; tile: { x: number; z: number }; distance: number }[];
            worldTile(): { x: number; z: number; level: number } | null;
            stat(i: number): { name: string; base: number; xp: number; effective: number };
            chat(n: number): { text: string }[];
            inCombat(): boolean;
            sideTabInterface(tab: number): number;
            varp(id: number): number;
        };
        input: { heldOp(id: number, slot: number, comId: number, op: number): boolean | Promise<boolean> };
    };
};
