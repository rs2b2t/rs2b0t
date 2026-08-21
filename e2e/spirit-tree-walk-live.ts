/** Spirit tree network walk on an account with every transport quest complete (#tree).
 *  Three legs, each planned through a Spirit Tree by the pack: the walk-up onto the Varrock
 *  young tree, the same walk from cross-country Varrock, and the village landing where the
 *  next hop leaves from the tile the last one landed on.
 *  A leg fails when the executor logs "not interactable" for a tree the plan asked for. */

//   ~/redeploy.sh
//   HEADED=1 bun e2e/spirit-tree-walk-live.ts [http://localhost:8890]
import type { Page } from 'playwright-core';
import { deployIsolatedClient, launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    applyNavPaintSettings,
    cheb,
    pathPaintFlagsFromEnv,
    restoreRunEnergy,
    setTickRate,
    teleArrive
} from './lib/navLiveHarness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog } from './tutorial/harness.js';
import {
    transportQuestJournalNames,
    transportQuestSetvarCommands
} from '../src/bot/event/webwalk/transportQuestReqs.js';

const BUDGET_MS = (Number(process.env.BUDGET_S) || 240) * 1000;
const TICK_MS = Number(process.env.TICK_MS) || 300;
const PAINT = pathPaintFlagsFromEnv({ teleports: false, cameraFollow: true });
const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});
const proof = createHarnessProof({ issue: 0, slug: 'spirit-tree-walk' });

type Tile = { x: number; z: number; level: number };

/** spirit_tree.constant landings; the trees themselves sit one to two tiles off each. */
const TREE = {
    varrock: { x: 3179, z: 3507, level: 0 },
    village: { x: 2542, z: 3169, level: 0 },
    khazard: { x: 2555, z: 3259, level: 0 }
} as const;

interface Leg {
    id: string;
    note: string;
    from: Tile;
    to: Tile;
    radius: number;
}

const LEGS: readonly Leg[] = [
    {
        id: 'varrock-tree-walkup',
        note: 'seven tiles south of the Varrock young tree → Tree Gnome Village, one hop, no cross-country walk',
        from: { x: 3179, z: 3500, level: 0 },
        to: TREE.village,
        radius: 4
    },
    {
        id: 'varrock-bank-to-ardougne',
        note: 'Varrock west bank → Ardougne bank, the route the quest bot plans: Varrock young → village → Khazard young',
        from: { x: 3185, z: 3436, level: 0 },
        to: { x: 2616, z: 3332, level: 0 },
        radius: 6
    },
    {
        id: 'village-landing-relay',
        note: 'Varrock young tree → village → Khazard, so the second hop starts on the tile the first one landed on',
        from: TREE.varrock,
        to: TREE.khazard,
        radius: 4
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
        Quests: { status(n: string): string };
    };
    rs2b0t: { runner: { start(meta: unknown): void; stop(reason: string): void; state: string } };
    __spiritWalk?: { walkOk: boolean; tile: Tile | null; logs: string[]; hops: string[] };
};

async function runWalk(page: Page, dest: Tile, radius: number): Promise<{
    walkOk: boolean;
    tile: Tile | null;
    logs: string[];
    hops: string[];
}> {
    await page.evaluate(
        ({ destination, r, budget }) => {
            const g = globalThis as never as Abi;
            g.__spiritWalk = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    const logs: string[] = [];
                    const hops: string[] = [];
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: r,
                            timeoutMs: budget,
                            useTeleportCatalog: false,
                            policy: { useTeleports: false, distanceBeforeTeleport: 0 },
                            log: m => {
                                logs.push(m);
                                this.log(m);
                                // The walker prints the plan as one message: a "hops:" line
                                // then "1. [portal] Talk-to Spirit Tree → x,z,L0" per hop.
                                for (const line of m.split('\n')) {
                                    if (/^\s*\d+\.\s*\[/.test(line)) {
                                        hops.push(line.trim());
                                    }
                                }
                            }
                        });
                        g.__spiritWalk = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs, hops };
                    } catch (e) {
                        g.__spiritWalk = {
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
                g.__rs2b0t.registerScript({ name: `SpiritWalk${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: dest, r: radius, budget: BUDGET_MS }
    );

    const deadline = Date.now() + BUDGET_MS + 30_000;
    while (Date.now() < deadline) {
        if (await page.evaluate(() => (globalThis as never as Abi).__spiritWalk !== undefined)) {
            break;
        }
        await page.waitForTimeout(500);
    }
    const res = await page.evaluate(() => (globalThis as never as Abi).__spiritWalk);
    return res ?? { walkOk: false, tile: null, logs: ['timeout waiting for walk'], hops: [] };
}

const client = deployIsolatedClient(`spirit-${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: string; ok: boolean; detail: string }[] = [];

try {
    await proof.ensureDirs();
    const user = `spt${Date.now().toString(36).slice(-6)}`;
    console.log(`spirit-tree-walk base=${base} tele=false budget≈${Math.round(BUDGET_MS / 1000)}s`);
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
    for (const q of statuses) {
        console.log(`  quest ${q.name}: ${q.status}`);
    }
    // Why: only the two gnome quests gate a spirit tree, and one bad seed elsewhere in the
    // table is worth a line rather than the run.
    const short = statuses.filter(q => q.status !== 'complete').map(q => q.name);
    if (short.length > 0) {
        console.log(`  note: not complete after setvar + relog: ${short.join(', ')}`);
    }
    const gates = ['The Grand Tree', 'Tree Gnome Village'];
    const ungated = statuses.filter(q => gates.includes(q.name) && q.status !== 'complete');
    if (ungated.length > 0) {
        throw new Error(`spirit tree gate not complete: ${ungated.map(q => `${q.name}=${q.status}`).join(', ')}`);
    }

    await setTickRate(page, TICK_MS);

    for (const leg of LEGS) {
        console.log(`\n══ ${leg.id} ══ ${leg.note}`);
        await teleArrive(page, leg.from);
        await restoreRunEnergy(page);
        const res = await runWalk(page, leg.to, leg.radius);
        const me = res.tile;
        const dist = me && me.level === leg.to.level ? cheb(me, leg.to) : 9999;
        const planned = res.hops.filter(h => /spirit tree/i.test(h));
        const refused = res.logs.filter(l => /spirit.*not interactable/i.test(l));
        const crossed = res.logs.filter(l => /spirit.*arrived/i.test(l));
        const at = me ? `(${me.x},${me.z},L${me.level})` : 'null';
        let ok = true;
        let reason = '';
        if (planned.length === 0) {
            ok = false;
            reason = 'no Spirit Tree hop planned, the leg proves nothing';
        } else if (refused.length > 0) {
            ok = false;
            reason = `tree refused ${refused.length}×: ${refused[0]}`;
        } else if (crossed.length === 0) {
            ok = false;
            reason = 'no spirit hop reported arrival';
        } else if (!res.walkOk || dist > leg.radius + 2) {
            ok = false;
            reason = 'walk did not arrive';
        }
        const detail = `at=${at} dist=${dist} walkOk=${res.walkOk} planned=${planned.length} crossed=${crossed.length} refused=${refused.length}`;
        results.push({ id: leg.id, ok, detail: ok ? detail : `${detail} (${reason})` });
        console.log(`${stamp()} ${ok ? 'PASS' : 'FAIL'} ${leg.id}: ${results[results.length - 1]!.detail}`);
        for (const l of res.logs.slice(-24)) {
            console.log(`  ${l}`);
        }
    }

    const pass = results.filter(r => r.ok).length;
    console.log(`\n── summary ${pass}/${results.length} pass ──`);
    for (const r of results) {
        console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.id}: ${r.detail}`);
    }
    if (pass === results.length) {
        await proof.writeSuccess(page, { legs: results, base });
        console.log(`proof=${proof.paths.successProof} screenshot=${proof.paths.successScreenshot}`);
        console.log('PASS spirit-tree-walk');
    } else {
        await proof.writeFailure(page, { legs: results, base });
        process.exit(1);
    }
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
    client.cleanup();
}
