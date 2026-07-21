// Shared plumbing for the tools/*-test.ts live smokes. Every smoke used to
// copy-paste the same fail/parseArgs/boot/login/type helpers, a Rs2b0t debug-
// global type, and the Chrome launch; this centralizes them so behavior stays
// identical across the fleet. The bodies are the CURRENT majority shape
// (agility/chaosdruid/fishing/… ): boot = loopCycle>10 @60s, login = ingame &&
// sceneState===2 @12s, type = canvas-click + keyboard.type(delay 25) + Enter.
//
// Per-file trailing waits (1300/1400/1500) are passed explicitly to type();
// only the shared shape lives here.

import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

/** Print a FAIL line and exit non-zero — the smokes' single failure path. */
export function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

/**
 * Order-independent CLI arg parse. An arg that looks like a URL (starts with
 * 'http' or contains '://') is the base; an arg that parses as a finite number
 * is the minutes budget; `--base <url>` / `--minutes <n>` flags work too;
 * everything else falls through to `rest` (usernames, modes, …). This keeps
 * BOTH historic call orders working (base-first AND minutes-first) and fixes
 * the run-all-smokes sweep, which spawns `bun tools/<name> <base>` — a
 * minutes-first smoke used to parse that URL as NaN minutes.
 */
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
        rest.push(a);
    }
    return {
        base: base ?? defaults?.base ?? 'http://localhost:8890',
        minutes: minutes ?? defaults?.minutes ?? 0,
        rest
    };
}

/**
 * Launch headless Chrome for a smoke. Default = system Chrome via the 'chrome'
 * channel. `swiftshader: true` uses the explicit Google Chrome binary with the
 * ANGLE/SwiftShader software-GL args (the canonical set the swiftshader smokes
 * use — see tollgate-test.ts).
 */
export async function launchBrowser(opts?: { swiftshader?: boolean }): Promise<Browser> {
    if (opts?.swiftshader) {
        return chromium.launch({
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless: true,
            args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']
        });
    }
    return chromium.launch({ channel: 'chrome', headless: true });
}

/** Wait for the client's main loop to be running (maininit finished). */
export function boot(page: Page): Promise<unknown> {
    return page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
}

/** Drive the client's own login() and wait until it reaches the game scene. */
export async function login(page: Page, user: string, pass = 'test'): Promise<boolean> {
    await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [user, pass]);
    return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
}

/**
 * Send a chat/cheat line by focusing the game canvas and typing it. The
 * trailing settle wait defaults to 1400ms; callers pass their own (1300/1500)
 * where they historically differed.
 */
export async function type(page: Page, text: string, waitMs?: number): Promise<void> {
    await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
    await page.waitForTimeout(400);
    await page.keyboard.type(text, { delay: 25 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(waitMs ?? 1400);
}

/** Generic off-Tutorial-Island teleport tile, used to unlock the sidebar tabs. */
const OFF_ISLAND_TELE = '::tele 0,50,50,20,20';

/**
 * Unlock a fresh (tutorial-locked) account: tele off Tutorial Island, reload,
 * re-boot, and re-login (the server needs a few seconds to drop the old
 * session, so retry 8× at 5s). Only for smokes whose bring-up matches this
 * canonical shape; smokes with a different retry count / bespoke type() keep
 * their loop inline.
 */
export async function bringUpOffIsland(page: Page, opts: { user: string; typeWaitMs?: number }): Promise<void> {
    await type(page, OFF_ISLAND_TELE, opts.typeWaitMs);
    await page.reload();
    await boot(page);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(page, opts.user); }
    if (!backIn) { fail('relogin failed'); }
}

/**
 * Pick a script through the ScriptLibrary Browse modal (the replacement for the
 * removed script-select dropdown): open Browse…, click the category chip,
 * click the script card, and wait for the modal to close. Selection only — the
 * caller clicks Start itself.
 */
export async function startFromLibrary(page: Page, category: string, script: string): Promise<void> {
    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.getByRole('button', { name: new RegExp(`^${category}`) }).click();
    await page.locator('.rs2b0t-library-card', { hasText: script }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });
}

/**
 * Structural type for the `rs2b0t` debug global, as reached through
 * `(globalThis as never as Rs2b0t).rs2b0t`. Deliberately a WIDE superset of
 * what the individual smokes read — every reader/runner field any migrated
 * smoke touches is present and required, so a `never`-cast in any file
 * type-checks. The runtime object only carries the fields each call actually
 * uses; this is a compile-time assertion, not a contract.
 */
export type Rs2b0t = {
    rs2b0t: {
        client: {
            ingame: boolean;
            sceneState: number;
            loginUser: string;
            loginPass: string;
            sideIcon: number[];
            loginMessage?: string;
            out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } | null;
            login(u: string, p: string, r: boolean): Promise<void>;
        };
        host: { tickCount: number };
        runner: {
            state: string;
            ctx: { log: { level: string; msg: string }[]; loopCount: number } | null;
            bot: Record<string, unknown> | null;
            start(script: unknown): void;
            stop(): void;
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
        router: { driver: { heldOp(id: number, slot: number, comId: number, op: number): boolean | Promise<boolean> } };
    };
};
