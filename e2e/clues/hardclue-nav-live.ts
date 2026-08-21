/** Web-walk to every hard clue destination on an account with the transport quests complete.
 *  This is a navigation sweep, not a solve: each leg teleports to a fixed start, walks to the
 *  clue's coord (or its talk anchor) and reports what the walker did on the way.
 *  A leg fails on a refused crossing, on a repath storm, or on not arriving.
 *  PACK_UNREACHABLE ids are skipped by default; they are pack gaps with a written diagnosis. */

//   ~/redeploy.sh
//   bun e2e/clues/hardclue-nav-live.ts                    # first 8 destinations
//   bun e2e/clues/hardclue-nav-live.ts --limit 0          # every destination (hours)
//   bun e2e/clues/hardclue-nav-live.ts --offset 8 --limit 8
//   bun e2e/clues/hardclue-nav-live.ts --ids 3530,3580    # named destinations
//   bun e2e/clues/hardclue-nav-live.ts --teleports        # let the route use teleports
//   bun e2e/clues/hardclue-nav-live.ts --include-known    # known pack gaps too
import type { Page } from 'playwright-core';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { PACK_UNREACHABLE } from '#/bot/api/ai/clues/data/unreachable.js';
import { TALK_ANCHORS } from '#/bot/api/ai/clues/data/talkAnchors.js';
import { deployIsolatedClient, launchBrowser } from '../lib/harness.js';
import { createHarnessProof } from '../lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    pathPaintFlagsFromEnv,
    restoreRunEnergy,
    setTickRate,
    teleArrive
} from '../lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from '../tutorial/harness.js';
import {
    transportQuestJournalNames,
    transportQuestSetvarCommands
} from '../../src/bot/event/webwalk/transportQuestReqs.js';

const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? (argv[i + 1] ?? null) : null;
};

const base = process.env.BASE ?? 'http://localhost:8890';
const LEG_MS = Number(arg('secs') ?? process.env.BUDGET_S ?? 300) * 1000;
const TICK_MS = Number(arg('speed') ?? process.env.TICK_MS ?? 300);
const OFFSET = Math.max(0, Number(arg('offset') ?? 0));
/** 0 means every destination after the offset. */
const LIMIT = Number(arg('limit') ?? 8);
const ONLY = arg('ids')?.split(',').map(Number);
const TELEPORTS = argv.includes('--teleports');
const INCLUDE_KNOWN = argv.includes('--include-known');
const PAINT = pathPaintFlagsFromEnv({ teleports: TELEPORTS, cameraFollow: true });
const proof = createHarnessProof({ issue: 0, slug: 'hardclue-nav' });

type Tile = { x: number; z: number; level: number };

/** Varrock east bank, the first origin tools/clues/audit-clues.ts plans from. */
const START: Tile = { x: 3253, z: 3420, level: 0 };

/** Every item a curated crossing asks for, so a gate is a walk rather than a pruned edge. */
const KIT: readonly [string, number][] = [
    ['coins', 100_000],
    ['shantay_pass', 5],
    ['rope', 5],
    ['spade', 1],
    ['machette', 1],
    ['gasmask', 1],
    ['death_climbingboots', 1]
];

/** Worn gates: the Plague City sewer wants the mask on, the Trollheim ascent the boots. */
const WORN = ['Gas mask', 'Climbing boots'];

interface Leg {
    id: number;
    obj: string;
    type: string;
    to: Tile;
    known?: string;
}

function destination(id: number): Tile | null {
    const row = CLUE_DB[id];
    if (row.coord) {
        return { ...row.coord };
    }
    const anchor = TALK_ANCHORS[id];
    return anchor ? { x: anchor.x, z: anchor.z, level: anchor.level } : null;
}

const LEGS: Leg[] = (() => {
    const ids = Object.keys(CLUE_DB)
        .map(Number)
        .filter(id => CLUE_DB[id].obj.includes('_hard_'))
        .filter(id => ONLY === undefined || ONLY.includes(id))
        .filter(id => INCLUDE_KNOWN || ONLY !== undefined || PACK_UNREACHABLE[id] === undefined)
        .sort((a, b) => a - b);
    const out: Leg[] = [];
    for (const id of ids) {
        const to = destination(id);
        if (!to) {
            console.log(`  skip ${id} ${CLUE_DB[id].obj}: no coord and no talk anchor`);
            continue;
        }
        out.push({ id, obj: CLUE_DB[id].obj, type: CLUE_DB[id].type, to, known: PACK_UNREACHABLE[id] });
    }
    const from = out.slice(OFFSET);
    return LIMIT > 0 ? from.slice(0, LIMIT) : from;
})();

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
        Quests: { status(n: string): string };
    };
    rs2b0t: { runner: { start(meta: unknown): void; stop(reason: string): void; state: string } };
    __clueNav?: { walkOk: boolean; tile: Tile | null; logs: string[]; hops: string[] };
};

async function equipWorn(page: Page): Promise<void> {
    // Why: Equipment.equip awaits a script context and throws from page.evaluate, so the op is
    // sent straight off the inventory entry the way the other live harnesses gear up.
    for (const name of WORN) {
        await page.evaluate(x => {
            const inv = (globalThis as never as {
                __rs2b0t: { Inventory: { first(n: string): { actions(): string[]; interact(a: string): unknown } | null } };
            }).__rs2b0t.Inventory;
            const entry = inv.first(x);
            const op = entry?.actions().find(o => /wear|wield|equip/i.test(o));
            if (entry && op) {
                entry.interact(op);
            }
        }, name);
        await page.waitForTimeout(600);
    }
}

async function runWalk(page: Page, dest: Tile): Promise<{
    walkOk: boolean;
    tile: Tile | null;
    logs: string[];
    hops: string[];
}> {
    await page.evaluate(
        ({ destination: target, budget, teleports }) => {
            const g = globalThis as never as Abi;
            g.__clueNav = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    const logs: string[] = [];
                    const hops: string[] = [];
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(target, {
                            radius: 2,
                            timeoutMs: budget,
                            useTeleportCatalog: teleports,
                            policy: { useTeleports: teleports, distanceBeforeTeleport: 0 },
                            log: m => {
                                logs.push(m);
                                this.log(m);
                                for (const line of m.split('\n')) {
                                    if (/^\s*\d+\.\s*\[/.test(line)) {
                                        hops.push(line.trim());
                                    }
                                }
                            }
                        });
                        g.__clueNav = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs, hops };
                    } catch (e) {
                        g.__clueNav = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)],
                            hops
                        };
                    } finally {
                        g.rs2b0t.runner.stop('harness stop');
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `ClueNav${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: dest, budget: LEG_MS, teleports: TELEPORTS }
    );

    const deadline = Date.now() + LEG_MS + 60_000;
    while (Date.now() < deadline) {
        if (await page.evaluate(() => (globalThis as never as Abi).__clueNav !== undefined)) {
            break;
        }
        await page.waitForTimeout(500);
    }
    const res = await page.evaluate(() => (globalThis as never as Abi).__clueNav);
    return res ?? { walkOk: false, tile: null, logs: ['timeout waiting for walk'], hops: [] };
}

// Why: a crossing the executor asked for and could not take is the failure this sweep exists to
// find. A repath is the walker working, and a Wilderness leg repaths half a dozen times on danger
// zones alone, so it is reported and never failed on.
// Why: "did not resolve, retrying" is WalkExecutor taking another swing at a loc the scene has not
// caught up with, and it usually lands. Only the repathing form is a crossing given up on.
const REFUSED_RE = /not interactable|did not resolve — repathing|refused \d+ crossings|could not open|remove weapons/i;

/** Repaths past which a leg is worth a look even though it arrived. */
const REPATH_NOISY = 6;

const client = deployIsolatedClient(`cluenav-${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: number; obj: string; ok: boolean; detail: string }[] = [];

try {
    await proof.ensureDirs();
    const user = `hcn${Date.now().toString(36).slice(-6)}`;
    console.log(
        `hardclue-nav base=${base} legs=${LEGS.length} tele=${TELEPORTS} `
            + `budget=${Math.round(LEG_MS / 1000)}s/leg tick=${TICK_MS}ms`
    );
    console.log(`${stamp()} boot '${user}'`);
    const page = await browser.newPage();
    await mainlandAccount(page, base, user, client.page);
    await applyNavPaintSettings(page, PAINT);
    await maxmeAndClearDialogs(page);

    const setvars = transportQuestSetvarCommands();
    console.log(`${stamp()} seeding ${setvars.length} transport quest varps`);
    for (const cmd of setvars) {
        await cheatQuiet(page, cmd);
    }
    // Why: the plan-time gate reads the quest-list colour, and only the login script's
    // ~update_questlist recolours it after a setvar.
    await relog(page, user);
    await applyNavPaintSettings(page, PAINT);
    await maxmeAndClearDialogs(page);
    const statuses = await page.evaluate(
        (names: string[]) =>
            names.map(n => ({ name: n, status: (globalThis as never as Abi).__rs2b0t.Quests.status(n) })),
        transportQuestJournalNames()
    );
    const short = statuses.filter(q => q.status !== 'complete').map(q => `${q.name}=${q.status}`);
    console.log(`  quests complete: ${statuses.length - short.length}/${statuses.length}`);
    if (short.length > 0) {
        console.log(`  note: ${short.join(', ')}`);
    }
    // Why: the planner prunes an edge whose `requires` the live state does not meet, so a bot with
    // no kit reads the desert, Trollheim and West Ardougne as unreachable rather than as long walks.
    for (const [obj, n] of KIT) {
        await cheatQuiet(page, `give ${obj} ${n}`);
    }
    await equipWorn(page);
    await setTickRate(page, TICK_MS);

    for (const leg of LEGS) {
        console.log(`\n══ ${leg.id} ${leg.obj} (${leg.type}) → ${leg.to.x},${leg.to.z},L${leg.to.level}`);
        if (leg.known) {
            console.log(`   known pack gap: ${leg.known}`);
        }
        await teleArrive(page, START);
        await restoreRunEnergy(page);
        const res = await runWalk(page, leg.to);
        const me = res.tile;
        const dist = me && me.level === leg.to.level ? cheb(me, leg.to) : 9999;
        const refused = res.logs.filter(l => REFUSED_RE.test(l));
        const repaths = res.logs.filter(l => /repathing|repath \d/.test(l)).length;
        const timedOut = res.logs.some(l => /walk timed out/.test(l));
        const at = me ? `(${me.x},${me.z},L${me.level})` : 'null';
        let ok = true;
        let reason = '';
        if (refused.length > 0) {
            ok = false;
            reason = `crossing refused: ${refused[0]}`;
        } else if (!res.walkOk || dist > 4) {
            ok = false;
            reason = timedOut ? 'walk timed out' : 'did not arrive';
        } else if (repaths >= REPATH_NOISY) {
            reason = `arrived, but it took ${repaths} repaths`;
        }
        const detail = `at=${at} dist=${dist} walkOk=${res.walkOk} hops=${res.hops.length} repaths=${repaths} refused=${refused.length}`;
        results.push({ id: leg.id, obj: leg.obj, ok, detail: reason ? `${detail} (${reason})` : detail });
        console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${leg.id}: ${results[results.length - 1]!.detail}`);
        for (const l of res.logs.slice(-16)) {
            console.log(`  ${l}`);
        }
    }

    const pass = results.filter(r => r.ok).length;
    const noisy = results.filter(r => r.ok && r.detail.includes('repaths)')).length;
    console.log(`\n── summary ${pass}/${results.length} pass${noisy > 0 ? `, ${noisy} noisy` : ''} ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id} ${r.obj}: ${r.detail}`);
    }
    const payload = { legs: results, teleports: TELEPORTS, offset: OFFSET, limit: LIMIT, base };
    if (pass === results.length) {
        await proof.writeSuccess(page, payload);
        console.log(`proof=${proof.paths.successProof}`);
        console.log(`PASS hardclue-nav ${pass}/${results.length}`);
    } else {
        await proof.writeFailure(page, payload);
        process.exit(1);
    }
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
    client.cleanup();
}
