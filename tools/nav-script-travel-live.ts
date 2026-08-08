/**
 * Live walk stress over **every** travel OD scraped from clues, gathering, and quests.
 *
 * Corpus: `tools/nav/script-travel-corpus.ts` (CLUE_DB, gather catalogs, quest areas.ts).
 *
 * Segments (SEGMENT=…):
 *   all | clues | quests | gathering-all | fishing | mining | woodcutting
 *   | firemaking | cooking
 *
 *   ~/redeploy.sh
 *   HEADED=1 SEGMENT=fishing LIMIT=0 bun tools/nav-script-travel-live.ts
 *   HEADED=1 SEGMENT=clues LIMIT=20 BUDGET_S=300 bun tools/nav-script-travel-live.ts
 *   HEADED=1 SEGMENT=quests OFFSET=0 LIMIT=50 bun tools/nav-script-travel-live.ts
 *   HEADED=1 SEGMENT=gathering-all bun tools/nav-script-travel-live.ts
 *
 * Startup uses clean **IF_BUTTON logout** (com 2458 → ClientProt.IF_BUTTON=9) after
 * tutorial varps so mainlandAccount relogs in ~9s instead of a long unclean hold.
 * See tools/tutorial/harness.ts mainlandAccount + relog.
 *
 * Shared harness: tools/lib/navLiveHarness.ts (paint, energy, tele kit, walk probe).
 *
 * LIMIT=0 → all legs in the segment (default 25 for safety).
 * OFFSET=N skips the first N legs (chunk long segments).
 * USE_TELEPORTS=0 pure-walk (still seeds runes only). ENERGY_REFILL_AT=25 mid-walk energy.
 * PATH_PAINT=1 (default) — pack path + cyan client segment + scene expand + camera yaw-follow.
 *   PATH_PAINT=0 / PATH_PAINT_SCENE_EXPAND=0 / PATH_PAINT_CLIENT_SEG=0 to turn pieces off.
 */
import fs from 'node:fs';
import path from 'node:path';

import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    energyRefillAtFromEnv,
    ensureJewellery,
    pathPaintFlagsFromEnv,
    restoreRunEnergy,
    runNavWalk,
    seedTeleKit,
    setTickRate,
    teleArrive,
    useTeleportsFromEnv,
    type NavTile
} from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';
import {
    TRAVEL_SEGMENTS,
    buildTravelRoutes,
    filterTravelRoutes,
    travelRouteStats,
    type TravelRoute,
    type TravelSegment
} from './nav/script-travel-corpus.js';
import {
    transportQuestJournalNames,
    transportQuestSetvarCommands
} from '../src/bot/nav/transportQuestReqs.js';

const TICK_MS = 300;
const TICK_RESTORE_MS = 600;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 240) * 1000;
const OFFSET = Math.max(0, Number(process.env.OFFSET) || 0);
/** LIMIT=0 means full segment (after OFFSET). Default 25 for safety. */
const LIVE_LIMIT_RAW = process.env.LIMIT;
const LIVE_LIMIT =
    LIVE_LIMIT_RAW === undefined || LIVE_LIMIT_RAW === ''
        ? 25
        : Number(LIVE_LIMIT_RAW);
const USE_TELEPORTS = useTeleportsFromEnv();
const PAINT = pathPaintFlagsFromEnv({ teleports: USE_TELEPORTS });
const ENERGY_REFILL_AT = energyRefillAtFromEnv();
const ARRIVAL = 8;
const SEED_QUESTS =
    process.env.SEED_QUESTS === '1'
    || process.env.SEED_QUESTS === 'true'
    || process.env.SEGMENT === 'quests';

const segmentRaw = (process.env.SEGMENT ?? 'all').toLowerCase() as TravelSegment;
const SEGMENT: TravelSegment = TRAVEL_SEGMENTS.includes(segmentRaw) ? segmentRaw : 'all';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const proof = createHarnessProof({ issue: 0, slug: `nav-script-travel-${SEGMENT}` });

function selectRoutes(): TravelRoute[] {
    const all = buildTravelRoutes();
    const filtered = filterTravelRoutes(all, SEGMENT);
    const sliced = OFFSET > 0 ? filtered.slice(OFFSET) : filtered;
    if (LIVE_LIMIT === 0 || !Number.isFinite(LIVE_LIMIT)) {
        return sliced;
    }
    return sliced.slice(0, Math.max(0, LIVE_LIMIT));
}

const routes = selectRoutes();
const stats = travelRouteStats(buildTravelRoutes());

console.log(
    `nav-script-travel-live base=${base} segment=${SEGMENT} offset=${OFFSET} limit=${LIVE_LIMIT === 0 ? 'ALL' : LIVE_LIMIT} `
    + `legs=${routes.length} tele=${USE_TELEPORTS} pathPaint=${PAINT.paint} sceneExpand=${PAINT.sceneExpand} `
    + `clientSeg=${PAINT.clientSeg} cameraFollow=${PAINT.cameraFollow} tick=${TICK_MS}ms energy≤${ENERGY_REFILL_AT}% `
    + `budget≈${Math.round(BUDGET_MS / 1000)}s`
);
console.log(`  corpus: ${JSON.stringify(stats)}`);

await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: string; ok: boolean; detail: string; segment: string }[] = [];

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
    const page = await context.newPage();
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log(`[browser:error] ${msg.text()}`);
        }
    });

    const user = process.env.USER_NAME || `nvtr${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} mainlandAccount '${user}' (clean IF_BUTTON logout relog)`);
    await mainlandAccount(page, base, user);
    await applyNavPaintSettings(page, PAINT);
    await maxmeAndClearDialogs(page);

    if (SEED_QUESTS) {
        const setvars = transportQuestSetvarCommands();
        console.log(`${stamp()} seeding ${setvars.length} transport quest varps…`);
        for (const cmd of setvars) {
            await cheatQuiet(page, cmd);
        }
        await cheatQuiet(page, '~item coins 5000');
        console.log(`${stamp()} relog (quest journal colours)`);
        await relog(page, user);
        await applyNavPaintSettings(page, PAINT);
        await maxmeAndClearDialogs(page);
        const statuses = await page.evaluate((names: string[]) => {
            const g = globalThis as never as {
                __rs2b0t: { Quests: { status(n: string): string } };
            };
            return names.map(n => ({ name: n, status: g.__rs2b0t.Quests.status(n) }));
        }, transportQuestJournalNames());
        for (const q of statuses.slice(0, 8)) {
            console.log(`  quest ${q.name}: ${q.status}`);
        }
    }

    // Runes + jewellery so product tele edges can fire when USE_TELEPORTS is on.
    await seedTeleKit(page, stamp, { useTeleports: USE_TELEPORTS });
    if (SEED_QUESTS || !USE_TELEPORTS) {
        await cheatQuiet(page, 'give coins 5000');
    }

    await setTickRate(page, TICK_MS);
    await restoreRunEnergy(page);

    let pass = 0;
    let fail = 0;
    for (let i = 0; i < routes.length; i++) {
        const r = routes[i]!;
        const id = r.id;
        console.log(`${stamp()} (${i + 1}/${routes.length}) ${id}: ${r.note}`);
        try {
            await ensureJewellery(page, { useTeleports: USE_TELEPORTS });
            await teleArrive(page, r.from as NavTile, 14);
            await restoreRunEnergy(page);
            const res = await runNavWalk(page, {
                dest: r.to as NavTile,
                budgetMs: BUDGET_MS,
                useTeleports: USE_TELEPORTS,
                distanceBeforeTeleport: 0,
                energyRefillAt: ENERGY_REFILL_AT,
                resultKey: '__navTravel',
                scriptNamePrefix: 'NavTravel'
            });
            const dist = res.tile ? cheb(res.tile, r.to as NavTile) : 9999;
            const ok = res.walkOk && dist <= ARRIVAL;
            const detail = `dist=${dist} walkOk=${res.walkOk} from=${r.from.x},${r.from.z}→${r.to.x},${r.to.z}`;
            console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(res.logs.slice(-12).join('\n'));
                fail++;
            } else {
                pass++;
            }
            results.push({ id, ok, detail, segment: r.segment });
        } catch (e) {
            console.error(`FAIL ${id}:`, e);
            results.push({ id, ok: false, detail: String(e), segment: r.segment });
            fail++;
        }
    }

    await setTickRate(page, TICK_RESTORE_MS);

    const outPath = path.join(process.cwd(), 'out', `nav-script-travel-${SEGMENT}-proof.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(
        outPath,
        JSON.stringify(
            {
                segment: SEGMENT,
                pass,
                fail,
                total: results.length,
                tele: USE_TELEPORTS,
                results
            },
            null,
            2
        )
    );
    console.log(`\n── summary ${pass}/${results.length} pass (wrote ${outPath}) ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }

    await proof.writeSuccess(page, {
        base,
        user,
        segment: SEGMENT,
        tele: USE_TELEPORTS,
        passed: pass,
        total: results.length,
        results
    });

    if (fail > 0) {
        process.exit(1);
    }
    console.log('PASS nav-script-travel-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
