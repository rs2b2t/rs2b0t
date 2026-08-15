/** Custom pure-walk / escort smoke (teleports off): Yanille bank 2612,3092 → dungeon warrior field 2580,9501; TGV centre 2542,3169 → outside maze ~2493,3187; then the Elkoy maze shortcut with Tree Gnome Village started.
 *  Content coords: elkoy entrance 0_39_49_8_56, maze land 0_39_49_19_23, balancing ledge 2580,9520 / 2580,9512; the web needs a plain Knife. PATH_PAINT=1 (default) → showNavPath + navCameraFollow + red pack / cyan client. */

//   ~/redeploy.sh
//   HEADED=1 bun e2e/nav-two-route-smoke-live.ts [http://localhost:8890]
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    pathPaintFlagsFromEnv,
    teleArrive
} from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';

const BUDGET_MS = (Number(process.env.BUDGET_S) || 300) * 1000;
/** Pure-walk smoke: teleports off; paint flags from env. */
const PAINT = pathPaintFlagsFromEnv({ teleports: false, cameraFollow: true });
const PATH_PAINT = PAINT.paint;
const PATH_PAINT_SCENE_EXPAND = PAINT.sceneExpand;
const PATH_PAINT_CLIENT_SEG = PAINT.clientSeg;
const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});
const proof = createHarnessProof({ issue: 0, slug: 'nav-two-route-pure' });

type Tile = { x: number; z: number; level: number };

type Route = {
    id: string;
    note: string;
    from: Tile;
    to: Tile;
    radius: number;
    /** Seed before this leg (after tele to from). May relog (needs account name). */
    setup?: (page: Page, user: string) => Promise<void>;
    /** Extra pass/fail beyond dist. */
    validate?: (ctx: {
        me: Tile | null;
        dist: number;
        walkOk: boolean;
        logs: string[];
        hops: string[];
    }) => { ok: boolean; reason?: string };
};

const ROUTES: Route[] = [
    {
        id: 'yanille-bank-dungeon-end',
        note: 'Yanille bank → chaos druid warrior field (web + stairs + ledge + walk in)',
        from: { x: 2612, z: 3092, level: 0 },
        // Why: the ledge south stand is 2580,9512, so radius ≥10 lets walkTo "arrive" on the ledge — radius 3 forces walking into the warrior cluster.
        to: { x: 2580, z: 9501, level: 0 },
        radius: 3,
        validate: ({ me, walkOk, dist, logs, hops }) => {
            // Warrior zone is z < 9519; ledge land ~9512. Require deep enough
            // that we left the ledge stand (ChaosDruid field radius ~8 around 9501).
            const inCamp =
                me !== null
                && me.level === 0
                && me.z >= 9494
                && me.z <= 9506
                && me.x >= 2572
                && me.x <= 2588;
            const ledge =
                hops.some(h => /balancing ledge|ledge/i.test(h))
                || logs.some(l => /balancing ledge/i.test(l));
            if (!walkOk || dist > 4) {
                return { ok: false, reason: 'dist/walkOk (need near 2580,9501, not ledge)' };
            }
            if (!inCamp) {
                return {
                    ok: false,
                    reason: 'not deep enough in warrior field (still on/near ledge?)'
                };
            }
            if (!ledge) {
                return { ok: false, reason: 'balancing ledge not used' };
            }
            return { ok: true };
        }
    },
    {
        id: 'tgv-centre-outside-maze',
        note: 'TGV centre → outside maze ~2493,3187 (pure walk, no Elkoy/spirit)',
        from: { x: 2542, z: 3169, level: 0 },
        to: { x: 2493, z: 3187, level: 0 },
        radius: 6,
        validate: ({ me, walkOk, dist, logs, hops }) => {
            const spirit =
                logs.some(l => /spirit tree/i.test(l)) || hops.some(h => /spirit tree/i.test(h));
            const elkoy = logs.some(l => /elkoy/i.test(l)) || hops.some(h => /elkoy/i.test(h));
            if (spirit) {
                return { ok: false, reason: 'spirit tree used (forbidden on pure maze)' };
            }
            if (elkoy) {
                return { ok: false, reason: 'Elkoy used (forbidden on pure maze; tested separately)' };
            }
            if (!walkOk || dist > 8) {
                return { ok: false, reason: 'dist/walkOk' };
            }
            // Outside / entrance side of the maze (west of village centre)
            if (!me || me.level !== 0 || me.x > 2510 || me.z < 3175) {
                return { ok: false, reason: 'not near outside maze dest ~2493,3187' };
            }
            return { ok: true };
        }
    },
    {
        id: 'elkoy-maze-shortcut-in',
        note: 'Elkoy outside → TGV centre (Tree Gnome Village started; maze escort)',
        // Content ^elkoy_entrance_coord stand; Elkoy outside wanders nearby
        from: { x: 2504, z: 3192, level: 0 },
        to: { x: 2542, z: 3169, level: 0 },
        radius: 6,
        setup: async (page, user) => {
            // Why: journal colour is client-only and a setvar alone does not recolour until relog; ^tree_complete=9 makes the list reliably green, minStatus started still passes, and postquest Elkoy still offers "Yes please."
            await cheatQuiet(page, 'setvar treequest 9', 800);
            await relog(page, user);
            // Relog drops Global settings — re-enable paint + camera like other smokes.
            await applyNavPaintSettings(page, PAINT);
            await cheatQuiet(page, 'give knife 1', 600);
            // Confirm journal after relog (plan-time gate reads list colour).
            const st = await page.evaluate(() => {
                const g = globalThis as {
                    __rs2b0t?: { Quests?: { status(n: string): string } };
                };
                return g.__rs2b0t?.Quests?.status('Tree Gnome Village') ?? 'no-api';
            });
            console.log(`  treequest journal after setvar+relog: ${st}`);
        },
        validate: ({ me, walkOk, dist, logs, hops }) => {
            const usedElkoy =
                hops.some(h => /elkoy/i.test(h)) || logs.some(l => /elkoy/i.test(l));
            if (!usedElkoy) {
                return { ok: false, reason: 'Elkoy hop not used' };
            }
            if (!walkOk || dist > 8) {
                return { ok: false, reason: 'dist/walkOk' };
            }
            if (!me || me.level !== 0 || Math.abs(me.x - 2542) > 8 || Math.abs(me.z - 3169) > 8) {
                return { ok: false, reason: 'not near Bolren / village centre' };
            }
            return { ok: true };
        }
    }
];

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: {
            walkTo(
                dest: Tile,
                opts: {
                    radius?: number;
                    timeoutMs?: number;
                    useTeleportCatalog?: boolean;
                    policy?: { useTeleports?: boolean; distanceBeforeTeleport?: number };
                    log?: (m: string) => void;
                }
            ): Promise<boolean>;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
        PathPublish: {
            get(): { tiles: Tile[]; pathIdx: number } | null;
        };
        SettingsStore: {
            save(ns: string, key: string, value: string): void;
        };
        isNavPathPaintEnabled(): boolean;
    };
    rs2b0t: {
        runner: { start(meta: unknown): void; stop(reason: string): void; state: string };
    };
    __twoRoute?: { walkOk: boolean; tile: Tile | null; logs: string[]; hops: string[] };
};

async function runWalk(page: Page, dest: Tile, radius: number, budgetMs: number): Promise<{
    walkOk: boolean;
    tile: Tile | null;
    logs: string[];
    hops: string[];
}> {
    await page.evaluate(
        ({ destination, r, budget }) => {
            const g = globalThis as never as Abi;
            g.__twoRoute = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    const logs: string[] = [];
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: r,
                            timeoutMs: budget,
                            useTeleportCatalog: false,
                            policy: { useTeleports: false, distanceBeforeTeleport: 0 },
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        const path = g.__rs2b0t.PathPublish.get();
                        const hops: string[] = [];
                        if (path) {
                            for (const t of path.tiles as Array<
                                Tile & { transport?: { locName?: string; action?: string; kind?: string } }
                            >) {
                                if (t.transport) {
                                    hops.push(
                                        `${t.transport.kind ?? '?'} ${t.transport.action ?? ''} ${t.transport.locName ?? ''}`.trim()
                                    );
                                }
                            }
                        }
                        g.__twoRoute = {
                            walkOk,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs,
                            hops
                        };
                    } catch (e) {
                        g.__twoRoute = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)],
                            hops: []
                        };
                    } finally {
                        g.rs2b0t.runner.stop('harness stop');
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `TwoRoute${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: dest, r: radius, budget: budgetMs }
    );

    const deadline = Date.now() + budgetMs + 30_000;
    while (Date.now() < deadline) {
        const done = await page.evaluate(() => (globalThis as never as Abi).__twoRoute !== undefined);
        if (done) {
            break;
        }
        await page.waitForTimeout(500);
    }
    const res = await page.evaluate(() => (globalThis as never as Abi).__twoRoute);
    if (!res) {
        return { walkOk: false, tile: null, logs: ['timeout waiting for walk'], hops: [] };
    }
    return res;
}

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: string; ok: boolean; detail: string }[] = [];

try {
    await proof.ensureDirs();
    const user = `n2r${Date.now().toString(36).slice(-6)}`;
    console.log(
        `nav-two-route-smoke base=${base} tele=false paint=${PATH_PAINT} `
            + `sceneExpand=${PATH_PAINT_SCENE_EXPAND} clientSeg=${PATH_PAINT_CLIENT_SEG} `
            + `budget≈${Math.round(BUDGET_MS / 1000)}s`
    );
    console.log(`${stamp()} boot '${user}'`);
    const page = await browser.newPage();
    await mainlandAccount(page, base, user);
    await applyNavPaintSettings(page, PAINT);
    await maxmeAndClearDialogs(page);
    // Plain knife for Yanille web use-on (content obj `knife`, not bronze_knife).
    // Do not complete Tree Gnome Village for pure maze; Elkoy leg seeds started.
    await cheatQuiet(page, 'give knife 1', 800);
    const paintOn = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.isNavPathPaintEnabled());
    console.log(
        `${stamp()} showNavPath=${paintOn} navCameraFollow=true `
            + `sceneExpand=${PATH_PAINT_SCENE_EXPAND} clientSeg=${PATH_PAINT_CLIENT_SEG}`
    );
    if (PATH_PAINT && !paintOn) {
        console.warn('WARNING: showNavPath still false after applyNavPaintSettings — paint will not draw');
    }

    for (const route of ROUTES) {
        console.log(`\n══ ${route.id} ══ ${route.note}`);
        await teleArrive(page, route.from);
        if (route.setup) {
            await route.setup(page, user);
            // Relog can drop us elsewhere — re-arrive at leg start.
            await teleArrive(page, route.from);
        }
        await cheatQuiet(page, '~energy', 400);
        const res = await runWalk(page, route.to, route.radius, BUDGET_MS);
        const me = res.tile;
        const dist = me && me.level === route.to.level ? cheb(me, route.to) : 9999;
        const at = me ? `(${me.x},${me.z},L${me.level})` : 'null';
        const baseDetail = `at=${at} dist=${dist} walkOk=${res.walkOk} hops=${res.hops.length}${
            res.hops.length ? ` [${res.hops.slice(0, 6).join('; ')}]` : ''
        }`;
        const v = route.validate
            ? route.validate({ me, dist, walkOk: res.walkOk, logs: res.logs, hops: res.hops })
            : { ok: res.walkOk && dist <= route.radius + 2 };
        const ok = v.ok;
        results.push({
            id: route.id,
            ok,
            detail: ok ? baseDetail : `${baseDetail}${v.reason ? ` (${v.reason})` : ''}`
        });
        console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${route.id}: ${results[results.length - 1]!.detail}`);
        for (const l of res.logs.slice(-22)) {
            console.log(`  ${l}`);
        }
        if (res.hops.length) {
            console.log(`  hops: ${res.hops.join(' | ')}`);
        }
    }

    const pass = results.filter(r => r.ok).length;
    console.log(`\n── summary ${pass}/${results.length} pass ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }
    if (pass === results.length) {
        await proof.writeSuccess(page, { routes: results, tele: false, base });
        console.log(`proof=${proof.paths.successProof} screenshot=${proof.paths.successScreenshot}`);
        console.log('PASS nav-two-route pure-walk + Elkoy smoke');
    } else {
        await proof.writeFailure(page, { routes: results, tele: false, base });
        process.exit(1);
    }
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
}
