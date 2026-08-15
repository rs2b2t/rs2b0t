/** Live walk stress over script-ripped high-traffic routes: HARD=1, TRANSPORT_HEAVY=1, SHIP_352=1, JEWELLERY_ONLY=1, LIMIT, BUDGET_S, PATH_PAINT, USE_TELEPORTS, ENERGY_REFILL_AT. Server tick drops to 300ms and is restored to 600 on exit; charged duel/glory/games neck are seeded at start and topped up each leg so OD paths may Rub.
 *  Why: `energy` alone is a no-op — the engine has no native energy cheat — so refills go through the content debugproc `~energy` (healenergy 10000 + run on), which needs p_finduid and retries while the player is mid protected script. */

//   ~/redeploy.sh
//   HEADED=1 HARD=1 ENERGY_REFILL_AT=25 bun e2e/nav-script-routes-live.ts
//   HEADED=1 TRANSPORT_HEAVY=1 LIMIT=12 bun e2e/nav-script-routes-live.ts
//   HEADED=1 LIMIT=8 BUDGET_S=180 bun e2e/nav-script-routes-live.ts
//   HEADED=1 LIMIT=10 bun e2e/nav-script-routes-live.ts
//   HEADED=1 SHIP_352=1 bun e2e/nav-script-routes-live.ts
//   HEADED=1 LIMIT=2 PATH_PAINT=1 bun e2e/nav-script-routes-live.ts   # dual red/cyan paint

// Pack-only: bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.js --hardest=25
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    energyRefillAtFromEnv,
    hpRefillAtFromEnv,
    sustainEverySecFromEnv,
    walkPollMsFromEnv,
    ensureJewellery,
    pathPaintFlagsFromEnv,
    restoreRunEnergy,
    runNavWalk,
    seedItem,
    seedTeleKit,
    setTickRate,
    teleArrive,
    useTeleportsFromEnv,
    type NavTile
} from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';
import type { ScriptRoute } from '../tools/nav/script-route-corpus.js';
import {
    transportQuestJournalNames,
    transportQuestSetvarCommands
} from '../src/bot/event/webwalk/transportQuestReqs.js';
import fs from 'node:fs';
import path from 'node:path';

const TICK_MS = 300;
const TICK_RESTORE_MS = 600;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 180) * 1000;
const LIVE_LIMIT = Number(process.env.LIMIT) || 14;
/** HARD=1 → walk precalc hardest list (tools/nav/script-routes.hardest.json; ranked with teles by default). */
const USE_HARDEST = process.env.HARD === '1' || process.env.HARD === 'true';
/** TRANSPORT_HEAVY=1 → curated transport-heavy OD list (tools/nav/transport-heavy.routes.json). */
const USE_TRANSPORT_HEAVY =
    process.env.TRANSPORT_HEAVY === '1' || process.env.TRANSPORT_HEAVY === 'true';
/**
 * SHIP_352=1 → Ardougne↔Brimhaven ship legs that reproduce #352 (stuck on boat / no plank).
 * Forces coins seed; ship/gangplank execute path.
 */
const USE_SHIP_352 = process.env.SHIP_352 === '1' || process.env.SHIP_352 === 'true';
/** Optional: USE_TELEPORTS=0 to disable spell/jewellery tele inject for a pure-walk smoke. */
const USE_TELEPORTS = useTeleportsFromEnv();
const PAINT = pathPaintFlagsFromEnv({ teleports: USE_TELEPORTS, cameraFollow: true });
const PATH_PAINT = PAINT.paint;
const PATH_PAINT_SCENE_EXPAND = PAINT.sceneExpand;
const PATH_PAINT_CLIENT_SEG = PAINT.clientSeg;
const ARRIVAL = 8;
/** Client run energy is 0–100; refill via `~energy` when at or below this. */
const ENERGY_REFILL_AT = energyRefillAtFromEnv();
const HP_REFILL_AT = hpRefillAtFromEnv();
const SUSTAIN_EVERY_S = sustainEverySecFromEnv();
const WALK_POLL_MS = walkPollMsFromEnv();
const HARDEST_JSON = path.join(process.cwd(), 'tools/nav/script-routes.hardest.json');
const TRANSPORT_HEAVY_JSON = path.join(process.cwd(), 'tools/nav/transport-heavy.routes.json');

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const proof = createHarnessProof({ issue: 0, slug: 'nav-script-routes' });

type Tile = NavTile;

/**
 * Prefer mainland + f2p-ish walk hubs + bank/camp commutes — the paths scripts thrash. Full pack mesh stays in script-route-corpus.js.
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

/** Load precalc from `script-route-corpus.js --hardest=N` (pack cost ranking). */
export function loadHardestRoutes(limit: number, file = HARDEST_JSON): ScriptRoute[] {
    if (!fs.existsSync(file)) {
        throw new Error(
            `missing ${file} — run:\n` +
                `  bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.js --hardest=${limit || 25}`
        );
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { routes: ScriptRoute[] };
    const list = raw.routes ?? [];
    if (list.length === 0) {
        throw new Error(`${file} has no routes`);
    }
    return limit > 0 ? list.slice(0, limit) : list;
}

/** Transport-heavy route; essence_roundtrip runs enter then exit without setvar. */
export type TransportHeavyRoute = ScriptRoute & {
    family?: string;
    /** Live: wizard → mine → portal (EssenceSession from entry hop only). */
    essenceRoundtrip?: string;
    minePad?: { x: number; z: number; level: number };
    /** When false, live walk disables tele catalog (force portal on exit leg). */
    useTeleports?: boolean;
};

/** Load transport-heavy list from `tools/nav/transport-heavy-routes.ts --write`. */
export function loadTransportHeavyRoutes(limit: number, file = TRANSPORT_HEAVY_JSON): TransportHeavyRoute[] {
    if (!fs.existsSync(file)) {
        throw new Error(
            `missing ${file} — run:\n` +
                `  bun tools/nav/transport-heavy-routes.ts --write --n=${limit || 14}`
        );
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { routes: TransportHeavyRoute[] };
    const list = raw.routes ?? [];
    if (list.length === 0) {
        throw new Error(`${file} has no routes`);
    }
    return limit > 0 ? list.slice(0, limit) : list;
}

const DEFAULT_MINE_PAD = { x: 2912, z: 4833, level: 0 };

/**
 * Multiloc product path: tele to wizard → walk into mine (entry sets
 * EssenceSession) → walk out via portal. No setvar / harness override.
 */
async function runEssenceRoundtrip(
    page: Page,
    route: TransportHeavyRoute,
    stamp: () => string
): Promise<{ ok: boolean; detail: string; logs: string[] }> {
    const mine = route.minePad ?? DEFAULT_MINE_PAD;
    const returnId = route.essenceRoundtrip ?? '?';
    const logs: string[] = [];
    const log = (m: string) => {
        logs.push(m);
    };

    // Clear any prior harness override so planner uses session from entry hop only.
    await page.evaluate(() => {
        const g = globalThis as never as {
            __rs2b0t?: { EssenceSession?: { clearHarnessOverride(): void; clear?(): void } };
        };
        g.__rs2b0t?.EssenceSession?.clearHarnessOverride?.();
    });

    console.log(
        `${stamp()} essence roundtrip: wizard → mine → portal (return=${returnId}, no setvar)`
    );
    await teleArrive(page, route.from);
    const into = await runWalk(page, {
        dest: mine,
        budget: BUDGET_MS,
        // Entry may use wizard hop; tele catalog off so we do not spell-tele into mine.
        useTeleports: false
    });
    logs.push(...into.logs);
    if (!into.tile) {
        return { ok: false, detail: 'entry leg: no tile after walk', logs };
    }
    // AcceptAnyLanding: anywhere in the mine (far from surface wizard stand).
    const inMine =
        into.tile.level === mine.level
        && Math.max(Math.abs(into.tile.x - mine.x), Math.abs(into.tile.z - mine.z)) <= 64;
    if (!inMine) {
        return {
            ok: false,
            detail: `entry leg did not land in mine (at ${into.tile.x},${into.tile.z} walkOk=${into.walkOk})`,
            logs
        };
    }
    log(`entry ok at ${into.tile.x},${into.tile.z}`);

    const out = await runWalk(page, {
        dest: route.to,
        budget: BUDGET_MS,
        useTeleports: false
    });
    logs.push(...out.logs);
    const dist = out.tile ? cheb(out.tile, route.to) : 9999;
    const ok = dist <= ARRIVAL;
    const detail = `roundtrip return=${returnId} entryInMine=true exitDist=${dist} walkOk=${out.walkOk}`;
    return { ok, detail, logs };
}

/** Issue #352: bots boarded Ardougne→Brimhaven and then sat on the deck without crossing the gangplank. These OD pairs force Barnaby/Customs Pay-fare plus the deck→shore gangplank.
 *  Stands from transports.json / specialCrossings: Barnaby 2683,3272 → deck 2775,3234 L1 → plank to 2772,3234 L0; reverse Customs 2772,3234 → Ardougne deck 2683,3268 L1 → shore. */
export function loadShip352Routes(limit = 2): ScriptRoute[] {
    const all: ScriptRoute[] = [
        {
            id: 'SHIP-352-ard-brim',
            from: { x: 2668, z: 3285, level: 0 },
            // Ashore Brimhaven (past plank), not the deck tile — forces disembark hop.
            to: { x: 2779, z: 3218, level: 0 },
            note: 'Ardougne docks → Brimhaven shore (Barnaby Pay-fare + gangplank Cross) #352',
            source: 'issue-352'
        },
        {
            id: 'SHIP-352-brim-ard',
            from: { x: 2779, z: 3218, level: 0 },
            to: { x: 2668, z: 3285, level: 0 },
            note: 'Brimhaven docks → Ardougne shore (Customs Pay-fare + gangplank Cross) #352',
            source: 'issue-352'
        }
    ];
    return limit > 0 ? all.slice(0, limit) : all;
}

/**
 * Seed list for non-HARD runs. Registers happy-dom when needed so BankLocations
 * (and friends) can import without a manual --preload.
 */
async function loadSeedRoutes(): Promise<ScriptRoute[]> {
    if (typeof globalThis.document === 'undefined') {
        const { GlobalRegistrator } = await import('@happy-dom/global-registrator');
        GlobalRegistrator.register();
    }
    const { buildScriptRoutes } = await import('../tools/nav/script-route-corpus.js');
    return buildScriptRoutes();
}

type WalkOpts = {
    dest: Tile;
    budget: number;
    allowTeleportIds?: string[];
    distanceBeforeTeleport?: number;
    useTeleports?: boolean;
};

async function runWalk(page: Page, opts: WalkOpts): Promise<{ walkOk: boolean; tile: Tile | null; logs: string[] }> {
    const teleOn = opts.useTeleports !== false && USE_TELEPORTS;
    return runNavWalk(page, {
        dest: opts.dest,
        budgetMs: opts.budget,
        useTeleports: teleOn,
        allowTeleportIds: opts.allowTeleportIds,
        distanceBeforeTeleport: opts.distanceBeforeTeleport,
        energyRefillAt: ENERGY_REFILL_AT,
        hpRefillAt: HP_REFILL_AT > 0 ? HP_REFILL_AT : undefined,
        sustainEverySec: SUSTAIN_EVERY_S,
        pollMs: WALK_POLL_MS,
        resultKey: '__navScriptRoute',
        scriptNamePrefix: 'NavScriptRoute'
    });
}

/**
 * Optional isolation legs (JEWELLERY_ONLY=1): clear pack, force allowlist Rub.
 * Default HARD/transport runs use seedTeleKit on routes instead.
 */
async function runJewelleryLegs(page: Page, budget: number): Promise<{ id: string; ok: boolean; detail: string }[]> {
    const out: { id: string; ok: boolean; detail: string }[] = [];

    {
        const id = 'JEWEL-duel-arena';
        console.log(`\n══ ${id} ══ isolation Rub (JEWELLERY_ONLY=1)`);
        try {
            await cheatQuiet(page, '~clearinv');
            await page.waitForTimeout(500);
            await seedItem(page, 'ring_of_dueling_8', /Ring of dueling\(/);
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

    {
        const id = 'JEWEL-glory-edge';
        console.log(`\n══ ${id} ══ isolation Rub (JEWELLERY_ONLY=1)`);
        try {
            await cheatQuiet(page, '~clearinv');
            await page.waitForTimeout(500);
            await seedItem(page, 'amulet_of_glory_4', /Amulet of glory\(/);
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

function jewelleryUsedInLogs(logs: string[]): boolean {
    return logs.some(l => /rubbing|jewellery tele|dueling_|glory_|games_necklace|Ring of dueling|Amulet of glory|Games necklace/i.test(l));
}

const all = USE_HARDEST || USE_TRANSPORT_HEAVY || USE_SHIP_352 ? [] : await loadSeedRoutes();
/** Skip TH-ess-* so LIMIT counts ship / glider / spirit / cart / Entrana legs instead.
 *  Why: essence multiloc entry is a wizard Teleport into a random mine pad, not a fixed pathfinder OD — the expansion budget fails even with the tele catalog on. */
function loadTransportHeavyForLive(limit: number): TransportHeavyRoute[] {
    const raw = loadTransportHeavyRoutes(0); // full list
    const filtered = raw.filter(r => !r.essenceRoundtrip && !/^TH-ess-/i.test(r.id));
    return limit > 0 ? filtered.slice(0, limit) : filtered;
}
const routes = USE_SHIP_352
    ? loadShip352Routes(LIVE_LIMIT || 2)
    : USE_TRANSPORT_HEAVY
        ? loadTransportHeavyForLive(LIVE_LIMIT || 12)
        : USE_HARDEST
            ? loadHardestRoutes(LIVE_LIMIT || 25)
            : pickLiveRoutes(all, LIVE_LIMIT);

console.log(
    `nav-script-routes-live base=${base} tick=${TICK_MS}ms energy≤${ENERGY_REFILL_AT}% refill limit=${LIVE_LIMIT} hard=${USE_HARDEST} transportHeavy=${USE_TRANSPORT_HEAVY} ship352=${USE_SHIP_352} tele=${USE_TELEPORTS} pathPaint=${PATH_PAINT} sceneExpand=${PATH_PAINT_SCENE_EXPAND} clientSeg=${PATH_PAINT_CLIENT_SEG} budget≈${Math.round(BUDGET_MS / 1000)}s`
);
console.log(
    USE_SHIP_352
        ? `  SHIP_352=1 → ${routes.length} Ardougne↔Brimhaven ship+plank legs (issue #352)`
        : USE_TRANSPORT_HEAVY
            ? `  TRANSPORT_HEAVY=1 → ${routes.length} routes from ${TRANSPORT_HEAVY_JSON}`
            : USE_HARDEST
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

    await applyNavPaintSettings(page, PAINT);

    await maxmeAndClearDialogs(page);

    // Why: content only recolours the quest list through ~update_questlist at login, so transport-heavy / HARD seed the quest varps and then relog.
    // SHIP_352 needs coins alone (Barnaby/Customs 30gp), no quest varps.
    if (USE_TRANSPORT_HEAVY || USE_HARDEST) {
        const setvars = transportQuestSetvarCommands();
        console.log(`${stamp()} seeding ${setvars.length} transport quest varps…`);
        for (const cmd of setvars) {
            if (!(await cheatQuiet(page, cmd))) {
                console.warn(`${stamp()} WARN setvar failed: ${cmd}`);
            }
        }
        // Coins for cart / tolls
        await cheatQuiet(page, '~item coins 5000');
        console.log(`${stamp()} relog so quest journal colours match setvar`);
        await relog(page, user);
        // Re-apply settings after relog
        await applyNavPaintSettings(page, PAINT);
        await maxmeAndClearDialogs(page);

        type QStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';
        const statuses = await page.evaluate((names: string[]) => {
            const g = globalThis as never as {
                __rs2b0t: { Quests: { status(n: string): QStatus } };
            };
            return names.map(n => ({ name: n, status: g.__rs2b0t.Quests.status(n) }));
        }, transportQuestJournalNames());
        let bad = 0;
        for (const q of statuses) {
            const ok = q.status === 'complete';
            console.log(`${stamp()} quest ${ok ? 'OK' : 'FAIL'}  ${q.name} → ${q.status}`);
            if (!ok) {
                bad++;
            }
        }
        if (bad > 0) {
            throw new Error(
                `${bad} transport quest(s) not complete after setvar+relog — check varp names/values`
            );
        }
    }

    // Runes + charged jewellery at start so OD paths may spell/Rub (not a fake end test).
    await seedTeleKit(page, stamp);
    // Coins for cart / toll / ship fares (classic + transport-heavy + #352 ships).
    if (USE_TRANSPORT_HEAVY || USE_SHIP_352 || USE_HARDEST || !USE_TELEPORTS) {
        await cheatQuiet(page, 'give coins 5000');
        console.log(`${stamp()} seeded coins for fares (ship/cart/toll)`);
    }
    console.log(`${stamp()} set tick ${TICK_MS}ms + full run energy`);
    await setTickRate(page, TICK_MS, { strict: true });
    await restoreRunEnergy(page);

    let jewelleryHops = 0;

    for (const r of routes) {
        const thr = r as TransportHeavyRoute;
        console.log(`\n══ ${r.id} ══ ${r.note}`);
        try {
            await restoreRunEnergy(page);
            await ensureJewellery(page);
            if (thr.family === 'essence_roundtrip' || thr.essenceRoundtrip) {
                const res = await runEssenceRoundtrip(page, thr, stamp);
                if (jewelleryUsedInLogs(res.logs)) {
                    jewelleryHops++;
                }
                console.log(`${stamp()} ${res.ok ? 'PASS' : 'FAIL'} ${r.id}: ${res.detail}`);
                if (!res.ok) {
                    console.log(res.logs.slice(-16).join('\n'));
                }
                results.push({ id: r.id, ok: res.ok, detail: res.detail });
                continue;
            }
            await teleArrive(page, r.from);
            const res = await runWalk(page, {
                dest: r.to,
                budget: BUDGET_MS,
                ...(thr.useTeleports === false ? { useTeleports: false } : {})
            });
            const dist = res.tile ? cheb(res.tile, r.to) : 9999;
            const usedJew = jewelleryUsedInLogs(res.logs);
            if (usedJew) {
                jewelleryHops++;
            }
            const ok = dist <= ARRIVAL;
            const detail = `dist=${dist} walkOk=${res.walkOk} from=${r.from.x},${r.from.z} to=${r.to.x},${r.to.z} [${r.source}]${
                usedJew ? ' jewelleryRub=1' : ''
            }`;
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

    if (USE_TELEPORTS) {
        console.log(
            `${stamp()} jewellery Rub observed on ${jewelleryHops}/${routes.length} OD leg(s) (seeded at start; natural plan)`
        );
    }
    // Optional synthetic isolation (clear inv + allowlist) — not the default path.
    if (process.env.JEWELLERY_ONLY === '1' || process.env.JEWELLERY_ONLY === 'true') {
        const jew = await runJewelleryLegs(page, BUDGET_MS);
        results.push(...jew);
    }

    const passed = results.filter(x => x.ok).length;
    console.log(
        `\n── summary ${passed}/${results.length} pass (tick ${TICK_MS}ms, energy full/leg + watch ≤${ENERGY_REFILL_AT}%) ──`
    );
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }

    await proof.writeSuccess(page, {
        base,
        user,
        tickMs: TICK_MS,
        energyCheat: '~energy',
        energyRefillAt: ENERGY_REFILL_AT,
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
