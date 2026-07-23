import { chromium } from 'playwright-core';
import type { Browser, Page } from 'playwright-core';

export function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
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
        rest.push(a);
    }
    return {
        base: base ?? defaults?.base ?? 'http://localhost:8890',
        minutes: minutes ?? defaults?.minutes ?? 0,
        rest
    };
}

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

export function boot(page: Page): Promise<unknown> {
    return page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
}

export async function login(page: Page, user: string, pass = 'test'): Promise<boolean> {
    await page.evaluate(([u, p]) => { const c = (globalThis as never as Rs2b0t).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [user, pass]);
    return page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
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
