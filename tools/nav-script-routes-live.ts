/**
 * Live walk stress over script-ripped high-traffic routes.
 *
 * Always:
 *   - server tick 300ms (`speed 300`) — restored to 600 on exit
 *   - full run energy + run on before each leg (`energy` debugproc)
 *
 *   ~/redeploy.sh
 *   HEADED=1 bun tools/nav-script-routes-live.ts
 *   HEADED=1 LIMIT=8 BUDGET_S=180 bun tools/nav-script-routes-live.ts
 *
 * Pack-only (no browser): bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';
import { buildScriptRoutes, type ScriptRoute } from './nav/script-route-corpus.ts';
import fs from 'node:fs';
import path from 'node:path';

const TICK_MS = 300;
const TICK_RESTORE_MS = 600;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 180) * 1000;
const LIVE_LIMIT = Number(process.env.LIMIT) || 14;
/** HARD=1 → walk precalc hardest list (tools/nav/script-routes.hardest.json). */
const USE_HARDEST = process.env.HARD === '1' || process.env.HARD === 'true';
const ARRIVAL = 8;
const HARDEST_JSON = path.join(process.cwd(), 'tools/nav/script-routes.hardest.json');

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const proof = createHarnessProof({ issue: 0, slug: 'nav-script-routes' });

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: {
            worldTile(): Tile | null;
            chat(n: number): { text: string }[];
        };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Inventory: { items(): { name: string | null }[] };
        Traversal: {
            walkTo(
                dest: Tile,
                opts: {
                    radius?: number;
                    timeoutMs?: number;
                    log?: (m: string) => void;
                    navEngine?: string;
                    useTeleportCatalog?: boolean;
                    policy?: { useTeleports?: boolean; distanceBeforeTeleport?: number; allowTeleportIds?: string[] };
                }
            ): Promise<boolean>;
        };
        SettingsStore: { save(name: string, key: string, raw: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: { runner: { state: string; start(meta: unknown): void; stop(): void } };
    __navScriptRoute?: { walkOk: boolean; tile: Tile | null; logs: string[] };
};

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 12): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 16; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(300);
                return;
            }
            await page.waitForTimeout(150);
        }
    }
    throw new Error(`tele to ${spot.x},${spot.z} failed`);
}

async function setTickRate(page: Page, ms: number): Promise<void> {
    if (!(await cheatQuiet(page, `speed ${ms}`))) {
        throw new Error(`could not send speed ${ms}`);
    }
    const confirmed = await page.evaluate(expected => {
        const lines = (globalThis as never as Abi).__rs2b0t.reader.chat(16);
        return lines.some(l => l.text.includes(`World speed was changed to ${expected}ms`));
    }, ms);
    if (!confirmed) {
        throw new Error(`server did not confirm speed ${ms}ms`);
    }
    console.log(`  tick rate → ${ms}ms`);
}

/** Full energy + run orb on (Server ::energy / debugproc energy). */
async function restoreRunEnergy(page: Page): Promise<void> {
    if (!(await cheatQuiet(page, 'energy'))) {
        throw new Error('could not send energy cheat');
    }
}

/**
 * Prefer mainland + f2p-ish walk hubs + bank/camp commutes — the paths scripts
 * actually thrash. Full pack mesh stays in script-route-corpus.ts.
 */
export function pickLiveRoutes(all: ScriptRoute[], limit: number): ScriptRoute[] {
    const score = (r: ScriptRoute): number => {
        if (r.source === 'mainland-routes.json') {
            return 100;
        }
        if (r.source === 'WALK_DESTINATIONS') {
            // Prefer dense f2p hubs over Rellekka/Yanille edges for live budget.
            const note = r.note.toLowerCase();
            const hubs = ['lumbridge', 'varrock', 'falador', 'edgeville', 'draynor', 'al kharid'];
            const hits = hubs.filter(h => note.includes(h)).length;
            return 50 + hits * 10;
        }
        if (r.source === 'BANK_LOCATIONS') {
            return 40;
        }
        if (r.source.includes('NAV_TARGETS') || r.source.includes('BANK')) {
            return 35;
        }
        return 10;
    };
    return [...all].sort((a, b) => score(b) - score(a)).slice(0, limit);
}

/** Load precalc from `script-route-corpus.ts --hardest=N` (pack cost ranking). */
export function loadHardestRoutes(limit: number, file = HARDEST_JSON): ScriptRoute[] {
    if (!fs.existsSync(file)) {
        throw new Error(
            `missing ${file} — run:\n` +
                `  bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --hardest=${limit || 25}`
        );
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { routes: ScriptRoute[] };
    const list = raw.routes ?? [];
    if (list.length === 0) {
        throw new Error(`${file} has no routes`);
    }
    return limit > 0 ? list.slice(0, limit) : list;
}

type WalkOpts = {
    dest: Tile;
    budget: number;
    allowTeleportIds?: string[];
    distanceBeforeTeleport?: number;
    useTeleports?: boolean;
};

async function runWalk(page: Page, opts: WalkOpts): Promise<{ walkOk: boolean; tile: Tile | null; logs: string[] }> {
    await page.evaluate(
        ({ destination, budgetMs, allowTeleportIds, distanceBeforeTeleport, useTeleports }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            g.__navScriptRoute = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: 4,
                            timeoutMs: budgetMs,
                            navEngine: 'v2',
                            useTeleportCatalog: useTeleports !== false,
                            policy: {
                                useTeleports: useTeleports !== false,
                                distanceBeforeTeleport: distanceBeforeTeleport ?? 40,
                                ...(allowTeleportIds ? { allowTeleportIds } : {})
                            },
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__navScriptRoute = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs };
                    } catch (e) {
                        g.__navScriptRoute = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)]
                        };
                    } finally {
                        g.rs2b0t.runner.stop();
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `NavScriptRoute${Date.now()}`, create: () => new Probe() })
            );
        },
        {
            destination: opts.dest,
            budgetMs: opts.budget,
            allowTeleportIds: opts.allowTeleportIds,
            distanceBeforeTeleport: opts.distanceBeforeTeleport,
            useTeleports: opts.useTeleports
        }
    );

    const budget = opts.budget;
    for (let i = 0; i < Math.ceil(budget / 1000) + 40; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return (
                g.__navScriptRoute !== undefined
                && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle')
            );
        });
        if (done) {
            break;
        }
        if (i > 0 && i % 20 === 0) {
            const mid = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            console.log(`    …walking ${mid ? `${mid.x},${mid.z}` : '?'}`);
        }
        await page.waitForTimeout(1000);
    }
    const result = await page.evaluate(() => (globalThis as never as Abi).__navScriptRoute);
    if (!result) {
        throw new Error('walk produced no result');
    }
    return result;
}

async function seedItem(page: Page, cmd: string, match: RegExp, tries = 8): Promise<void> {
    for (let i = 0; i < tries; i++) {
        await cheatQuiet(page, cmd);
        await page.waitForTimeout(350);
        const ok = await page.evaluate(pattern => {
            const rx = new RegExp(pattern, 'i');
            return (globalThis as never as Abi).__rs2b0t.Inventory.items().some(it => it.name !== null && rx.test(it.name));
        }, match.source);
        if (ok) {
            return;
        }
    }
    throw new Error(`could not seed ${cmd}`);
}

/**
 * Jewellery is inventory-only at plan time (PathFinder scans state.items).
 * Bank planner deliberately does not withdraw glory/duel rings.
 * These legs clear runes, seed jewellery, and pin allowTeleportIds so Rub must fire.
 */
async function runJewelleryLegs(page: Page, budget: number): Promise<{ id: string; ok: boolean; detail: string }[]> {
    const out: { id: string; ok: boolean; detail: string }[] = [];

    // Duel ring: Lumb → Duel Arena
    {
        const id = 'JEWEL-duel-arena';
        console.log(`\n══ ${id} ══ inventory Rub only (no runes, no bank cache)`);
        try {
            await cheatQuiet(page, '~clearinv');
            await page.waitForTimeout(400);
            await seedItem(page, '~item ring_of_dueling_8 1', /Ring of dueling\(/);
            await restoreRunEnergy(page);
            await teleArrive(page, { x: 3222, z: 3218, level: 0 });
            const dest = { x: 3315, z: 3235, level: 0 };
            const res = await runWalk(page, {
                dest,
                budget,
                allowTeleportIds: ['dueling_arena'],
                distanceBeforeTeleport: 30
            });
            const dist = res.tile ? cheb(res.tile, dest) : 9999;
            const usedJew = res.logs.some(l => /rubbing|jewellery tele|dueling_arena|Ring of dueling/i.test(l));
            const ok = usedJew && dist <= ARRIVAL;
            const detail = `dist=${dist} jewelleryRub=${usedJew} walkOk=${res.walkOk}`;
            console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(res.logs.slice(-15).join('\n'));
            }
            out.push({ id, ok, detail });
        } catch (e) {
            console.error(`FAIL ${id}:`, e);
            out.push({ id, ok: false, detail: String(e) });
        }
    }

    // Glory: Al Kharid → Edgeville
    {
        const id = 'JEWEL-glory-edge';
        console.log(`\n══ ${id} ══ inventory Rub only (no runes, no bank cache)`);
        try {
            await cheatQuiet(page, '~clearinv');
            await page.waitForTimeout(400);
            await seedItem(page, '~item amulet_of_glory_4 1', /Amulet of glory\(/);
            await restoreRunEnergy(page);
            await teleArrive(page, { x: 3293, z: 3174, level: 0 });
            const dest = { x: 3087, z: 3496, level: 0 };
            const res = await runWalk(page, {
                dest,
                budget,
                allowTeleportIds: ['glory_edgeville'],
                distanceBeforeTeleport: 40
            });
            const dist = res.tile ? cheb(res.tile, dest) : 9999;
            const usedJew = res.logs.some(l => /rubbing|jewellery tele|glory_edgeville|Amulet of glory/i.test(l));
            const ok = usedJew && dist <= ARRIVAL;
            const detail = `dist=${dist} jewelleryRub=${usedJew} walkOk=${res.walkOk}`;
            console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(res.logs.slice(-15).join('\n'));
            }
            out.push({ id, ok, detail });
        } catch (e) {
            console.error(`FAIL ${id}:`, e);
            out.push({ id, ok: false, detail: String(e) });
        }
    }

    return out;
}

const all = buildScriptRoutes();
const routes = USE_HARDEST ? loadHardestRoutes(LIVE_LIMIT || 25) : pickLiveRoutes(all, LIVE_LIMIT);

console.log(
    `nav-script-routes-live base=${base} tick=${TICK_MS}ms energy=full limit=${LIVE_LIMIT} hard=${USE_HARDEST} budget≈${Math.round(BUDGET_MS / 1000)}s`
);
console.log(
    USE_HARDEST
        ? `  HARD=1 → ${routes.length} precalc hardest from ${HARDEST_JSON}`
        : `  selected ${routes.length} of ${all.length} script-ripped routes (hub score)`
);

await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
let page: Page | null = null;
const results: { id: string; ok: boolean; detail: string }[] = [];

try {
    const context = await browser.newContext();
    await context.route('**/*.{js,mjs}', async route => {
        await route.continue({
            headers: {
                ...route.request().headers(),
                'Cache-Control': 'no-cache',
                Pragma: 'no-cache'
            }
        });
    });
    page = await context.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`[browser:error] ${msg.text()}`);
        }
    });

    const user = process.env.USER_NAME || `nv2r${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} boot '${user}'`);
    await mainlandAccount(page, base, user);

    await setSettings(page, 'Global', { showNavPath: true, navEngine: 'v2' });
    await page.evaluate(() => {
        const g = globalThis as never as Abi;
        g.__rs2b0t.SettingsStore.save('Global', 'showNavPath', 'true');
        g.__rs2b0t.SettingsStore.save('Global', 'navEngine', 'v2');
    });

    await maxmeAndClearDialogs(page);
    // Tele runes so v2 can collapse long hub legs (still pure-walk when no tele).
    for (const cmd of ['~item lawrune 80', '~item airrune 200', '~item firerune 80', '~item waterrune 80', '~item earthrune 80']) {
        await cheatQuiet(page, cmd);
    }
    console.log(`${stamp()} set tick ${TICK_MS}ms + full run energy`);
    await setTickRate(page, TICK_MS);
    await restoreRunEnergy(page);

    for (const r of routes) {
        console.log(`\n══ ${r.id} ══ ${r.note}`);
        try {
            await restoreRunEnergy(page);
            await teleArrive(page, r.from);
            const res = await runWalk(page, { dest: r.to, budget: BUDGET_MS });
            const dist = res.tile ? cheb(res.tile, r.to) : 9999;
            const ok = dist <= ARRIVAL;
            const detail = `dist=${dist} walkOk=${res.walkOk} from=${r.from.x},${r.from.z} to=${r.to.x},${r.to.z} [${r.source}]`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${r.id}: ${detail}`);
            if (!ok) {
                console.log(res.logs.slice(-12).join('\n'));
            }
            results.push({ id: r.id, ok, detail });
        } catch (e) {
            console.error(`${stamp()} FAIL ${r.id}:`, e);
            results.push({ id: r.id, ok: false, detail: String(e) });
        }
    }

    // Jewellery: separate from script mesh — inventory-only plan (no bank jewellery cache).
    if (process.env.SKIP_JEWELLERY !== '1') {
        const jew = await runJewelleryLegs(page, BUDGET_MS);
        results.push(...jew);
    }

    const passed = results.filter(x => x.ok).length;
    console.log(`\n── summary ${passed}/${results.length} pass (tick ${TICK_MS}ms, energy restored per leg) ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }

    await proof.writeSuccess(page, {
        base,
        user,
        tickMs: TICK_MS,
        energyCheat: 'energy',
        passed,
        total: results.length,
        results
    });

    if (passed < results.length) {
        process.exit(1);
    }
    console.log('PASS nav-script-routes-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    if (page) {
        await proof.writeFailure(page).catch(() => undefined);
    }
    process.exit(1);
} finally {
    if (page) {
        try {
            const ingame = await page.evaluate(() => {
                try {
                    return (globalThis as never as { rs2b0t?: { client?: { ingame?: boolean } } }).rs2b0t?.client
                        ?.ingame;
                } catch {
                    return false;
                }
            });
            if (ingame) {
                await cheatQuiet(page, `speed ${TICK_RESTORE_MS}`).catch(() => undefined);
                console.log(`  tick rate restored → ${TICK_RESTORE_MS}ms`);
            }
        } catch {
            /* ignore */
        }
    }
    await browser.close().catch(() => undefined);
}
