/**
 * Live stress suite for nav-v2: spell teles, jewellery Rub, pure walk + path paint,
 * trapdoor, multi-destination chain.
 *
 * Operator only — not upstream CI.
 *
 *   ~/redeploy.sh
 *   HEADED=1 bun tools/nav-v2-stress-live.ts
 *
 * Optional: BASE=…  CASES=spell-varrock,jewellery-duel,path-paint  BUDGET_S=120
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs, setSettings } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const BUDGET_MS = (Number(process.env.BUDGET_S) || 120) * 1000;
// No issue number → out/nav-v2-stress-proof.json (not issue0-…).
const proof = createHarnessProof({ slug: 'nav-v2-stress' });

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: { count(name: string): number; items(): { name: string | null }[] };
        Skills: { level(name: string): number };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
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
            walkResilient(
                dest: Tile,
                opts: { radius: number; attempts: number; timeoutMs: number; log: (m: string) => void }
            ): Promise<boolean>;
        };
        PathPublish: {
            get(): { tiles: Tile[]; pathIdx: number; clickIdx: number } | null;
            clear(): void;
        };
        isNavPathPaintEnabled(): boolean;
        SettingsStore: { save(name: string, key: string, raw: string): void };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(): void };
    };
    __navStress?: {
        walkOk: boolean;
        tile: Tile | null;
        logs: string[];
        pathSamples: { n: number; pathIdx: number; hasTransport: boolean }[];
        paintOn: boolean;
    };
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

async function teleArrive(page: Page, spot: Tile, maxDist = 10): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 16; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(400);
                return;
            }
            await page.waitForTimeout(200);
        }
    }
    throw new Error(`tele to ${spot.x},${spot.z} failed`);
}

async function seedItem(page: Page, cmd: string, match: string | RegExp, tries = 8): Promise<void> {
    const re = typeof match === 'string' ? new RegExp(match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : match;
    for (let i = 0; i < tries; i++) {
        await cheatQuiet(page, cmd);
        await page.waitForTimeout(350);
        const ok = await page.evaluate(pattern => {
            const items = (globalThis as never as Abi).__rs2b0t.Inventory.items();
            const rx = new RegExp(pattern, 'i');
            return items.some(it => it.name !== null && rx.test(it.name));
        }, re.source);
        if (ok) {
            return;
        }
    }
    throw new Error(`could not seed ${cmd} (want name ~ ${re})`);
}

async function seedRunes(page: Page): Promise<void> {
    for (const [cmd, name] of [
        ['~item lawrune 80', 'Law rune'],
        ['~item airrune 200', 'Air rune'],
        ['~item firerune 80', 'Fire rune'],
        ['~item waterrune 80', 'Water rune'],
        ['~item earthrune 80', 'Earth rune']
    ] as const) {
        await seedItem(page, cmd, name);
    }
}

async function clearInv(page: Page): Promise<void> {
    await cheatQuiet(page, '~clearinv');
    await page.waitForTimeout(400);
}

type WalkOpts = {
    dest: Tile;
    budget?: number;
    navEngine?: 'classic' | 'v2';
    useTeleports?: boolean;
    distanceBeforeTeleport?: number;
    allowTeleportIds?: string[];
    samplePath?: boolean;
    radius?: number;
};

async function runWalk(page: Page, opts: WalkOpts): Promise<NonNullable<Abi['__navStress']>> {
    const budget = opts.budget ?? BUDGET_MS;
    await page.evaluate(
        ({ destination, budgetMs, navEngine, useTeleports, distanceBeforeTeleport, allowTeleportIds, samplePath, radius }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            const pathSamples: { n: number; pathIdx: number; hasTransport: boolean }[] = [];
            g.__navStress = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    let sampler: ReturnType<typeof setInterval> | null = null;
                    try {
                        if (samplePath) {
                            sampler = setInterval(() => {
                                const p = g.__rs2b0t.PathPublish.get();
                                if (p && p.tiles.length > 0) {
                                    pathSamples.push({
                                        n: p.tiles.length,
                                        pathIdx: p.pathIdx,
                                        hasTransport: p.tiles.some(t => (t as { transport?: boolean }).transport === true)
                                    });
                                }
                            }, 400);
                        }
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: radius ?? 4,
                            timeoutMs: budgetMs,
                            navEngine,
                            useTeleportCatalog: useTeleports !== false && navEngine === 'v2',
                            policy:
                                navEngine === 'v2'
                                    ? {
                                          useTeleports: useTeleports !== false,
                                          distanceBeforeTeleport: distanceBeforeTeleport ?? 40,
                                          ...(allowTeleportIds ? { allowTeleportIds } : {})
                                      }
                                    : undefined,
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__navStress = {
                            walkOk,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs,
                            pathSamples,
                            paintOn: g.__rs2b0t.isNavPathPaintEnabled()
                        };
                    } catch (e) {
                        g.__navStress = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)],
                            pathSamples,
                            paintOn: false
                        };
                    } finally {
                        if (sampler) {
                            clearInterval(sampler);
                        }
                        g.rs2b0t.runner.stop();
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `NavStress${Date.now()}`, create: () => new Probe() })
            );
        },
        {
            destination: opts.dest,
            budgetMs: budget,
            navEngine: opts.navEngine ?? 'v2',
            useTeleports: opts.useTeleports,
            distanceBeforeTeleport: opts.distanceBeforeTeleport,
            allowTeleportIds: opts.allowTeleportIds,
            samplePath: opts.samplePath ?? false,
            radius: opts.radius ?? 4
        }
    );

    for (let i = 0; i < Math.ceil(budget / 1000) + 40; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return (
                g.__navStress !== undefined
                && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle')
            );
        });
        if (done) {
            break;
        }
        if (i > 0 && i % 15 === 0) {
            const mid = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            console.log(`    …still walking ${mid ? `${mid.x},${mid.z}` : '?'}`);
        }
        await page.waitForTimeout(1000);
    }

    const result = await page.evaluate(() => (globalThis as never as Abi).__navStress);
    if (!result) {
        throw new Error('walk produced no result');
    }
    return result;
}

type CaseResult = { id: string; ok: boolean; detail: string };

const ALL_CASES = [
    'path-paint',
    'spell-varrock',
    'spell-falador',
    'jewellery-duel',
    'jewellery-glory',
    'trapdoor-edge',
    'classic-short'
] as const;

type CaseId = (typeof ALL_CASES)[number];

function selectedCases(): CaseId[] {
    const raw = process.env.CASES?.trim();
    if (!raw) {
        return [...ALL_CASES];
    }
    const want = raw.split(/[,\s]+/).filter(Boolean);
    return ALL_CASES.filter(c => want.includes(c));
}

const cases = selectedCases();
if (cases.length === 0) {
    console.error(
        `FAIL: CASES matched nothing. Want one of: ${ALL_CASES.join(', ')}\n` +
            `  got CASES=${JSON.stringify(process.env.CASES ?? '')}`
    );
    process.exit(2);
}

console.log(
    `nav-v2-stress-live base=${base} budget≈${Math.round(BUDGET_MS / 1000)}s cases=${cases.join(',')}`
);
console.log(`  proof → ${proof.paths.successProof}  screenshot → ${proof.paths.successScreenshot}`);
await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
let page: Page | null = null;
const results: CaseResult[] = [];

try {
    const context = await browser.newContext();
    await context.route('**/*.{js,mjs}', async route => {
        const headers = {
            ...route.request().headers(),
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache'
        };
        await route.continue({ headers });
    });
    // Prefer Playwright default / HARNESS_VIEWPORT (1280×720) — not 1500×1000.
    // Large viewports upscale bot.html's 765×503 stage and look huge vs GatheringBot.
    page = await context.newPage();
    page.on('console', msg => {
        const t = msg.type();
        if (t === 'log' || t === 'warning' || t === 'error') {
            const text = msg.text();
            if (/path|tele|hop|rub|nav|casting|jewellery|paint|PathPublish/i.test(text) || t === 'error') {
                console.log(`[browser:${t}] ${text}`);
            }
        }
    });

    const user = process.env.USER_NAME || `nv2s${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} boot '${user}'`);
    await mainlandAccount(page, base, user);

    // Global toggles for path paint + default engine preference (walk opts still force v2).
    await setSettings(page, 'Global', { showNavPath: true, navEngine: 'v2' });
    // Re-read via SettingsStore after save (sessionStorage).
    await page.evaluate(() => {
        const g = globalThis as never as Abi;
        g.__rs2b0t.SettingsStore.save('Global', 'showNavPath', 'true');
        g.__rs2b0t.SettingsStore.save('Global', 'navEngine', 'v2');
    });

    console.log(`${stamp()} seed runes + maxme`);
    await seedRunes(page);
    await maxmeAndClearDialogs(page);

    const paintOn = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.isNavPathPaintEnabled());
    console.log(`${stamp()} showNavPath=${paintOn}`);
    if (!paintOn) {
        console.warn('WARNING: showNavPath still false after setSettings — paint case may soft-fail');
    }

    // ── path-paint: pure walk, sample PathPublish mid-route ─────────────
    if (cases.includes('path-paint')) {
        const id = 'path-paint';
        console.log(`\n══ ${id} ══`);
        try {
            await teleArrive(page, { x: 3222, z: 3218, level: 0 });
            // Chicken pen is a short walk through a gate — good paint trail.
            const dest = { x: 3232, z: 3298, level: 0 };
            const r = await runWalk(page, {
                dest,
                samplePath: true,
                useTeleports: false,
                budget: 90_000
            });
            const dist = r.tile ? cheb(r.tile, dest) : 9999;
            const samples = r.pathSamples.length;
            const maxTiles = r.pathSamples.reduce((m, s) => Math.max(m, s.n), 0);
            const ok = dist <= 6 && samples >= 2 && maxTiles >= 5;
            const detail = `dist=${dist} pathSamples=${samples} maxTiles=${maxTiles} paintOn=${r.paintOn} walkOk=${r.walkOk}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.slice(-12).join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    // ── spell-varrock ───────────────────────────────────────────────────
    if (cases.includes('spell-varrock')) {
        const id = 'spell-varrock';
        console.log(`\n══ ${id} ══`);
        try {
            await seedRunes(page);
            await teleArrive(page, { x: 3222, z: 3218, level: 0 });
            const dest = { x: 3213, z: 3424, level: 0 };
            const r = await runWalk(page, {
                dest,
                useTeleports: true,
                distanceBeforeTeleport: 50,
                samplePath: true
            });
            const dist = r.tile ? cheb(r.tile, dest) : 9999;
            const usedTele = r.logs.some(l => /casting\s+Varrock|Varrock teleport ok|\[teleport\].*Varrock/i.test(l));
            const ok = usedTele && dist <= 10;
            const detail = `dist=${dist} tele=${usedTele} samples=${r.pathSamples.length}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    // ── spell-falador ───────────────────────────────────────────────────
    if (cases.includes('spell-falador')) {
        const id = 'spell-falador';
        console.log(`\n══ ${id} ══`);
        try {
            await seedRunes(page);
            await teleArrive(page, { x: 3222, z: 3218, level: 0 });
            const dest = { x: 2965, z: 3378, level: 0 };
            const r = await runWalk(page, {
                dest,
                useTeleports: true,
                distanceBeforeTeleport: 50,
                allowTeleportIds: ['falador']
            });
            const dist = r.tile ? cheb(r.tile, dest) : 9999;
            const usedTele = r.logs.some(l => /casting\s+Falador|Falador teleport ok|\[teleport\].*Falador/i.test(l));
            const ok = usedTele && dist <= 12;
            const detail = `dist=${dist} tele=${usedTele}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    // ── jewellery-duel: only duel ring, no runes ────────────────────────
    if (cases.includes('jewellery-duel')) {
        const id = 'jewellery-duel';
        console.log(`\n══ ${id} ══`);
        try {
            await clearInv(page);
            await seedItem(page, '~item ring_of_dueling_8 1', /Ring of dueling\(/);
            await teleArrive(page, { x: 3222, z: 3218, level: 0 });
            const dest = { x: 3315, z: 3235, level: 0 }; // Duel Arena
            const r = await runWalk(page, {
                dest,
                useTeleports: true,
                distanceBeforeTeleport: 30,
                allowTeleportIds: ['dueling_arena']
            });
            const dist = r.tile ? cheb(r.tile, dest) : 9999;
            const usedJew = r.logs.some(l => /rubbing|jewellery tele|dueling_arena|Ring of dueling/i.test(l));
            const ok = usedJew && dist <= 12;
            const detail = `dist=${dist} jewellery=${usedJew}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    // ── jewellery-glory → Edgeville ─────────────────────────────────────
    if (cases.includes('jewellery-glory')) {
        const id = 'jewellery-glory';
        console.log(`\n══ ${id} ══`);
        try {
            await clearInv(page);
            await seedItem(page, '~item amulet_of_glory_4 1', /Amulet of glory\(/);
            // Start far (Al Kharid) so glory is worth it
            await teleArrive(page, { x: 3293, z: 3174, level: 0 });
            const dest = { x: 3087, z: 3496, level: 0 }; // Edgeville glory landing
            const r = await runWalk(page, {
                dest,
                useTeleports: true,
                distanceBeforeTeleport: 40,
                allowTeleportIds: ['glory_edgeville']
            });
            const dist = r.tile ? cheb(r.tile, dest) : 9999;
            const usedJew = r.logs.some(l => /rubbing|jewellery tele|glory_edgeville|Amulet of glory/i.test(l));
            const ok = usedJew && dist <= 12;
            const detail = `dist=${dist} jewellery=${usedJew}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    // ── trapdoor-edge ───────────────────────────────────────────────────
    if (cases.includes('trapdoor-edge')) {
        const id = 'trapdoor-edge';
        console.log(`\n══ ${id} ══`);
        try {
            await teleArrive(page, { x: 3090, z: 3470, level: 0 });
            const under = { x: 3096, z: 9868, level: 0 };
            // use walkTo with v2 (trapdoor is loc edge, not tele)
            const r = await runWalk(page, {
                dest: under,
                useTeleports: false,
                budget: 90_000,
                samplePath: true
            });
            const dist = r.tile ? cheb(r.tile, under) : 9999;
            const climb = r.logs.some(l => /climb|trapdoor|open/i.test(l));
            const ok = dist <= 6 && (r.walkOk || climb);
            const detail = `dist=${dist} climbLog=${climb} samples=${r.pathSamples.length}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.slice(-20).join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    // ── classic-short: classic engine, no tele catalog ──────────────────
    if (cases.includes('classic-short')) {
        const id = 'classic-short';
        console.log(`\n══ ${id} ══`);
        try {
            await teleArrive(page, { x: 3222, z: 3218, level: 0 });
            const dest = { x: 3232, z: 3298, level: 0 };
            const r = await runWalk(page, {
                dest,
                navEngine: 'classic',
                useTeleports: false,
                budget: 90_000
            });
            const dist = r.tile ? cheb(r.tile, dest) : 9999;
            const noV2 = !r.logs.some(l => /nav engine=v2|casting /i.test(l));
            const ok = dist <= 6 && noV2;
            const detail = `dist=${dist} noV2tele=${noV2} walkOk=${r.walkOk}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.slice(-15).join('\n'));
            }
            results.push({ id, ok, detail });
        } catch (e) {
            results.push({ id, ok: false, detail: String(e) });
            console.error(`${stamp()} FAIL ${id}:`, e);
        }
    }

    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);
    console.log(`\n── summary ${passed}/${results.length} pass ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }

    if (results.length === 0) {
        console.error('FAIL: no case results recorded (internal bug)');
        process.exit(2);
    }

    await proof.writeSuccess(page, {
        base,
        user,
        cases,
        passed,
        total: results.length,
        results
    });
    console.log(`wrote ${proof.paths.successProof} (${results.length} case result(s))`);

    if (failed.length > 0) {
        console.error(`FAIL nav-v2-stress-live ${failed.length} case(s)`);
        process.exit(1);
    }
    console.log('PASS nav-v2-stress-live all cases');
    process.exit(0);
} catch (e) {
    console.error(e);
    if (page) {
        await proof.writeFailure(page).catch(() => undefined);
    }
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
