/** Focused live harness for explore path paint: CASES=…, LIMIT=…, PATH_PAINT_SCENE_EXPAND=0. Operator only, and needs explore/client-path-paint redeployed.
 *  Watches PathPublish during each leg and reports maxTiles + maxClientSeg; red = pack path, cyan = last walk-click scene BFS segment. Shared harness: e2e/lib/navLiveHarness.ts */

//   ~/redeploy.sh   # on explore/client-path-paint
//   HEADED=1 bun e2e/nav-path-paint-live.ts
//   HEADED=1 CASES=lumb-dray,varrock-edge LIMIT=1 bun e2e/nav-path-paint-live.ts
//   HEADED=1 PATH_PAINT_SCENE_EXPAND=0 bun e2e/nav-path-paint-live.ts  # Chebyshev expand only
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    energyRefillAtFromEnv,
    maybeSustain,
    pathPaintFlagsFromEnv,
    restoreRunEnergy,
    sustainEverySecFromEnv,
    teleArrive,
    walkPollMsFromEnv
} from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const BUDGET_MS = (Number(process.env.BUDGET_S) || 150) * 1000;
const ENERGY_REFILL_AT = energyRefillAtFromEnv();
const SUSTAIN_EVERY_S = sustainEverySecFromEnv();
const WALK_POLL_MS = walkPollMsFromEnv();
/** This harness always paints; only scene-expand / client-seg toggles come from env. */
const PATH_PAINT_SCENE_EXPAND =
    process.env.PATH_PAINT_SCENE_EXPAND !== '0' && process.env.PATH_PAINT_SCENE_EXPAND !== 'false';
const PATH_PAINT_CLIENT_SEG =
    process.env.PATH_PAINT_CLIENT_SEG !== '0' && process.env.PATH_PAINT_CLIENT_SEG !== 'false';
const PAINT = {
    ...pathPaintFlagsFromEnv({ teleports: false, cameraFollow: true }),
    paint: true,
    sceneExpand: PATH_PAINT_SCENE_EXPAND,
    clientSeg: PATH_PAINT_CLIENT_SEG,
    teleports: false,
    cameraFollow: true
};

const proof = createHarnessProof({ slug: 'nav-path-paint' });
const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

type Tile = { x: number; z: number; level: number };

type Sample = {
    n: number;
    pathIdx: number;
    clickIdx: number;
    clientSegN: number;
};

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null; energy(): number };
        Game: { energy(): number };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: {
            walkTo(
                dest: Tile,
                opts: {
                    radius?: number;
                    timeoutMs?: number;
                    log?: (m: string) => void;
                                        useTeleportCatalog?: boolean;
                }
            ): Promise<boolean>;
        };
        PathPublish: {
            get(): {
                tiles: Tile[];
                pathIdx: number;
                clickIdx: number;
                clientSegment?: Tile[];
            } | null;
        };
        isNavPathPaintEnabled(): boolean;
        SettingsStore: { save(name: string, key: string, raw: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: { runner: { state: string; start(meta: unknown): void; stop(reason: string): void } };
    __navPaint?: {
        walkOk: boolean;
        tile: Tile | null;
        logs: string[];
        samples: Sample[];
        paintOn: boolean;
        maxTiles: number;
        maxClientSeg: number;
    };
};

type CaseDef = { id: string; from: Tile; to: Tile; note: string };

const ALL: CaseDef[] = [
    {
        id: 'lumb-chicken',
        from: { x: 3222, z: 3218, level: 0 },
        to: { x: 3232, z: 3298, level: 0 },
        note: 'Lumbridge → chicken pen (short gate walk)'
    },
    {
        id: 'lumb-dray',
        from: { x: 3222, z: 3218, level: 0 },
        to: { x: 3093, z: 3243, level: 0 },
        note: 'Lumbridge → Draynor bank (doors; multi-click)'
    },
    {
        id: 'varrock-edge',
        from: { x: 3213, z: 3424, level: 0 },
        to: { x: 3094, z: 3493, level: 0 },
        note: 'Varrock square → Edgeville bank'
    },
    {
        id: 'fally-taverley',
        from: { x: 2965, z: 3378, level: 0 },
        to: { x: 2895, z: 3435, level: 0 },
        note: 'Falador → Taverley (gate / walls)'
    }
];

function pickCases(): CaseDef[] {
    const raw = process.env.CASES?.trim();
    const limit = Number(process.env.LIMIT) || 0;
    let list = raw
        ? ALL.filter(c => raw.split(/[,\s]+/).includes(c.id))
        : [...ALL];
    if (list.length === 0) {
        console.error(`FAIL: no cases. Known: ${ALL.map(c => c.id).join(', ')}`);
        process.exit(2);
    }
    if (limit > 0) {
        list = list.slice(0, limit);
    }
    return list;
}

async function runWalk(page: Page, dest: Tile): Promise<NonNullable<Abi['__navPaint']>> {
    await page.evaluate(
        ({ destination, budgetMs }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            const samples: Sample[] = [];
            g.__navPaint = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    let sampler: ReturnType<typeof setInterval> | null = null;
                    try {
                        sampler = setInterval(() => {
                            const p = g.__rs2b0t.PathPublish.get();
                            if (p && p.tiles.length > 0) {
                                samples.push({
                                    n: p.tiles.length,
                                    pathIdx: p.pathIdx,
                                    clickIdx: p.clickIdx,
                                    clientSegN: p.clientSegment?.length ?? 0
                                });
                            }
                        }, 350);
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: 4,
                            timeoutMs: budgetMs,
                            useTeleportCatalog: false,
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__navPaint = {
                            walkOk,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs,
                            samples,
                            paintOn: g.__rs2b0t.isNavPathPaintEnabled(),
                            maxTiles: samples.reduce((m, s) => Math.max(m, s.n), 0),
                            maxClientSeg: samples.reduce((m, s) => Math.max(m, s.clientSegN), 0)
                        };
                    } catch (e) {
                        g.__navPaint = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)],
                            samples,
                            paintOn: false,
                            maxTiles: samples.reduce((m, s) => Math.max(m, s.n), 0),
                            maxClientSeg: samples.reduce((m, s) => Math.max(m, s.clientSegN), 0)
                        };
                    } finally {
                        if (sampler) {
                            clearInterval(sampler);
                        }
                        g.rs2b0t.runner.stop('harness stop');
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `NavPathPaint${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: dest, budgetMs: BUDGET_MS }
    );

    const sustainClock = { t: 0 };
    const maxPolls = Math.ceil(BUDGET_MS / WALK_POLL_MS) + 20;
    const progressEveryPolls = Math.max(1, Math.round(15_000 / WALK_POLL_MS));
    for (let i = 0; i < maxPolls; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return (
                g.__navPaint !== undefined
                && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle')
            );
        });
        if (done) {
            break;
        }
        await maybeSustain(
            page,
            { energyRefillAt: ENERGY_REFILL_AT, everySec: SUSTAIN_EVERY_S },
            sustainClock
        ).catch(() => undefined);
        if (i > 0 && i % progressEveryPolls === 0) {
            const mid = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            console.log(`    …walking ${mid ? `${mid.x},${mid.z}` : '?'}`);
        }
        await page.waitForTimeout(WALK_POLL_MS);
    }
    const result = await page.evaluate(() => (globalThis as never as Abi).__navPaint);
    if (!result) {
        throw new Error('walk produced no result');
    }
    return result;
}

const cases = pickCases();
console.log(
    `nav-path-paint-live base=${base}  sceneExpand=${PATH_PAINT_SCENE_EXPAND} clientSeg=${PATH_PAINT_CLIENT_SEG} cases=${cases.map(c => c.id).join(',')} budget≈${Math.round(BUDGET_MS / 1000)}s`
);
console.log('  watch: red = pack path, cyan = client walk segment (after each click)');

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

    const user = process.env.USER_NAME || `npp${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} boot '${user}'`);
    await mainlandAccount(page, base, user);

    await applyNavPaintSettings(page, { ...PAINT, paint: true, teleports: false, cameraFollow: true });

    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');
    await restoreRunEnergy(page);

    const paintOn = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.isNavPathPaintEnabled());
    console.log(`${stamp()} showNavPath=${paintOn}`);
    if (!paintOn) {
        console.warn('WARNING: showNavPath false — paint will not draw');
    }

    for (const c of cases) {
        console.log(`\n══ ${c.id} ══ ${c.note}`);
        try {
            await restoreRunEnergy(page);
            await teleArrive(page, c.from);
            const r = await runWalk(page, c.to);
            const dist = r.tile ? cheb(r.tile, c.to) : 9999;
            const clientHits = r.samples.filter(s => s.clientSegN >= 2).length;
            // Soft visual harness: arrive + pack path samples; clientSeg when feature on
            const needClient = PATH_PAINT_CLIENT_SEG;
            const ok =
                dist <= 8
                && r.samples.length >= 2
                && r.maxTiles >= 4
                && (!needClient || (r.maxClientSeg >= 2 && clientHits >= 1));
            const detail =
                `dist=${dist} samples=${r.samples.length} maxTiles=${r.maxTiles} ` +
                `maxClientSeg=${r.maxClientSeg} clientHits=${clientHits} paintOn=${r.paintOn} walkOk=${r.walkOk}`;
            console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${c.id}: ${detail}`);
            if (!ok) {
                console.log(r.logs.slice(-10).join('\n'));
            }
            results.push({ id: c.id, ok, detail });
        } catch (e) {
            console.error(`${stamp()} FAIL ${c.id}:`, e);
            results.push({ id: c.id, ok: false, detail: String(e) });
        }
    }

    const passed = results.filter(x => x.ok).length;
    console.log(`\n── summary ${passed}/${results.length} pass ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }

    await proof.writeSuccess(page, {
        base,
        user,
        pathPaint: {
            sceneExpand: PATH_PAINT_SCENE_EXPAND,
            clientSeg: PATH_PAINT_CLIENT_SEG
        },
        passed,
        total: results.length,
        results
    });

    if (passed < results.length) {
        process.exit(1);
    }
    console.log('PASS nav-path-paint-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    if (page) {
        await proof.writeFailure(page).catch(() => undefined);
    }
    process.exit(1);
} finally {
    if (page) {
        await cheatQuiet(page, 'speed 600').catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
}
