/** Live walk stress over every travel OD scraped from clues, gathering and quests (corpus: tools/nav/script-travel-corpus.ts). SEGMENT=all|clues|quests|gathering-all|fishing|mining|woodcutting|firemaking|cooking, LIMIT (0 = all, default 25), OFFSET, USE_TELEPORTS, PATH_PAINT, ENERGY_REFILL_AT, HP_REFILL_AT, SUSTAIN_EVERY_S. A success proof is written only when every leg passes.
 *  Why: startup logs out through IF_BUTTON com 2458 so mainlandAccount relogs in ~9s rather than holding a long unclean disconnect; STUCK_ABORT kills a leg whose wall time far exceeds the path-cost estimate while the character has not moved (door thrash), and HARNESS_SUITE_ABORT stops the suite on harness death alone — product OD failures continue. */

//   ~/redeploy.sh
//   HEADED=1 SEGMENT=fishing LIMIT=0 bun e2e/nav-script-travel-live.ts
//   HEADED=1 SEGMENT=clues LIMIT=20 BUDGET_S=300 bun e2e/nav-script-travel-live.ts
//   HEADED=1 SEGMENT=quests OFFSET=0 LIMIT=50 bun e2e/nav-script-travel-live.ts
//   HEADED=1 SEGMENT=gathering-all bun e2e/nav-script-travel-live.ts
import fs from 'node:fs';
import path from 'node:path';

import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    energyRefillAtFromEnv,
    ensureJewellery,
    harnessSuiteAbortFromEnv,
    hpRefillAtFromEnv,
    isHarnessDeathDetail,
    pathPaintFlagsFromEnv,
    restoreHp,
    restoreRunEnergy,
    runNavWalk,
    seedTeleKit,
    setTickRate,
    stuckAbortFromEnv,
    sustainEverySecFromEnv,
    teleArrive,
    useTeleportsFromEnv,
    walkPollMsFromEnv,
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
} from '../tools/nav/script-travel-corpus.js';
import {
    transportQuestJournalNames,
    transportQuestSetvarCommands
} from '../src/bot/event/webwalk/transportQuestReqs.js';

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
const HP_REFILL_AT = hpRefillAtFromEnv();
const SUSTAIN_EVERY_S = sustainEverySecFromEnv();
const WALK_POLL_MS = walkPollMsFromEnv();
const STUCK_ABORT_RAW = stuckAbortFromEnv();
/** Align stuck est wall-clock with this suite's setTickRate (not generic TICK_MS env). */
const STUCK_ABORT = STUCK_ABORT_RAW
    ? { ...STUCK_ABORT_RAW, tickMs: TICK_MS }
    : undefined;
const HARNESS_SUITE_ABORT = harnessSuiteAbortFromEnv();
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

const KIT_SEEDED = USE_TELEPORTS;
const PURE_WALK = !USE_TELEPORTS;
const stuckNote = STUCK_ABORT
    ? `stuckAbort=×${STUCK_ABORT.factor}/min${STUCK_ABORT.minElapsedMs / 1000}s/noMove${STUCK_ABORT.noMoveMs / 1000}s`
    : 'stuckAbort=off';
console.log(
    `nav-script-travel-live base=${base} segment=${SEGMENT} offset=${OFFSET} limit=${LIVE_LIMIT === 0 ? 'ALL' : LIVE_LIMIT} `
    + `legs=${routes.length} tele=${USE_TELEPORTS} kitSeeded=${KIT_SEEDED} pureWalk=${PURE_WALK} `
    + `pathPaint=${PAINT.paint} sceneExpand=${PAINT.sceneExpand} `
    + `clientSeg=${PAINT.clientSeg} cameraFollow=${PAINT.cameraFollow} tick=${TICK_MS}ms `
    + `energy≤${ENERGY_REFILL_AT}% hp≤${HP_REFILL_AT || 'off'} sustainEvery=${SUSTAIN_EVERY_S}s `
    + `walkPoll=${WALK_POLL_MS}ms budget≈${Math.round(BUDGET_MS / 1000)}s ${stuckNote} suiteAbort=${HARNESS_SUITE_ABORT}`
);
console.log(`  corpus: ${JSON.stringify(stats)}`);

await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: string; ok: boolean; detail: string; segment: string }[] = [];
let suiteAbortReason: string | null = null;
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
            // One HP top-up at leg start if enabled (not every tick — mid-walk is throttled).
            if (HP_REFILL_AT > 0) {
                await restoreHp(page, 99).catch(() => undefined);
            }
            const res = await runNavWalk(page, {
                dest: r.to as NavTile,
                budgetMs: BUDGET_MS,
                useTeleports: USE_TELEPORTS,
                distanceBeforeTeleport: 0,
                energyRefillAt: ENERGY_REFILL_AT,
                hpRefillAt: HP_REFILL_AT > 0 ? HP_REFILL_AT : undefined,
                sustainEverySec: SUSTAIN_EVERY_S,
                pollMs: WALK_POLL_MS,
                resultKey: '__navTravel',
                scriptNamePrefix: 'NavTravel',
                stuckAbort: STUCK_ABORT
            });
            const dist = res.tile ? cheb(res.tile, r.to as NavTile) : 9999;
            const ok = res.walkOk && dist <= ARRIVAL;
            const stuckHit = res.logs.some(l => l.includes('harness stuck abort'));
            const detail =
                `dist=${dist} walkOk=${res.walkOk} from=${r.from.x},${r.from.z}→${r.to.x},${r.to.z}`
                + (stuckHit ? ' stuckAbort=1' : '');
            console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
            if (!ok) {
                console.log(res.logs.slice(-12).join('\n'));
                fail++;
            } else {
                pass++;
            }
            results.push({ id, ok, detail, segment: r.segment });
        } catch (e) {
            const detail = String(e);
            console.error(`FAIL ${id}:`, e);
            results.push({ id, ok: false, detail, segment: r.segment });
            fail++;
            // Harness death only — product OD fails continue the suite.
            if (HARNESS_SUITE_ABORT && isHarnessDeathDetail(detail)) {
                suiteAbortReason = detail;
                console.error(
                    `${stamp()} SUITE ABORT (harness death) after ${id}: ${detail.slice(0, 200)}`
                );
                break;
            }
        }
    }

    await setTickRate(page, TICK_RESTORE_MS);

    const outPath = path.join(process.cwd(), 'out', `nav-script-travel-${SEGMENT}-proof.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const planned = routes.length;
    const summary = {
        segment: SEGMENT,
        pass,
        fail,
        total: results.length,
        planned,
        tele: USE_TELEPORTS,
        kitSeeded: KIT_SEEDED,
        pureWalk: PURE_WALK,
        stuckAbort: STUCK_ABORT
            ? {
                factor: STUCK_ABORT.factor,
                minElapsedS: STUCK_ABORT.minElapsedMs / 1000,
                noMoveS: STUCK_ABORT.noMoveMs / 1000
            }
            : null,
        harnessSuiteAbort: HARNESS_SUITE_ABORT,
        suiteAbortReason,
        results
    };
    fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
    const abortNote = suiteAbortReason ? ` ABORTED=${suiteAbortReason.slice(0, 80)}` : '';
    console.log(
        `\n── summary ${pass}/${results.length} pass`
        + (results.length < planned ? ` (${planned - results.length} not run)` : '')
        + ` (wrote ${outPath})${abortNote} ──`
    );
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }

    const proofBody = {
        base,
        user,
        segment: SEGMENT,
        tele: USE_TELEPORTS,
        kitSeeded: KIT_SEEDED,
        pureWalk: PURE_WALK,
        passed: pass,
        fail,
        total: results.length,
        planned,
        suiteAbortReason,
        results
    };
    if (fail === 0 && !suiteAbortReason) {
        await proof.writeSuccess(page, proofBody);
        console.log('PASS nav-script-travel-live');
        process.exit(0);
    }
    await proof.writeFailure(page, proofBody).catch(() => undefined);
    process.exit(1);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
