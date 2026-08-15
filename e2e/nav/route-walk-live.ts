/** Nav A/B: walk a fixed corpus of door / stair / transport-heavy ODs and report the outcome plus the walker's own log for each. --base, --out, ROUTES=1,4,7.
 *  One account, one walk at a time, over live ODs, so two builds can be diffed line for line. */

//   bun e2e/nav/route-walk-live.ts --base http://localhost:8890 --out out/routes-head.json
//   ROUTES=1,4,7 bun e2e/nav/route-walk-live.ts
import fs from 'node:fs';

import type { Page } from 'playwright-core';

import { launchBrowser, parseArgs } from '../lib/harness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, relog, teleTo } from '../tutorial/harness.js';

type Tile = { x: number; z: number; level: number };

interface Route {
    name: string;
    from: Tile;
    to: Tile;
    radius?: number;
    /** Wall-clock budget for the walk (ms). */
    budgetMs?: number;
}

const ROUTES: Route[] = [
    // Door / stair dense — the cases the stall ladder exists for. Endpoints from
    // tools/nav/script-routes.hardest.json (hop-ranked).
    { name: 'varrock-bank-L1→camelot-tower-L2', from: { x: 3250, z: 3419, level: 1 }, to: { x: 2749, z: 3495, level: 2 }, radius: 4, budgetMs: 300_000 },
    { name: 'varrock-bank-L1→draynor-manor-L2', from: { x: 3250, z: 3419, level: 1 }, to: { x: 3106, z: 3368, level: 2 }, radius: 4, budgetMs: 240_000 },
    { name: 'fishing-guild-L1→grand-tree-bank-L1', from: { x: 2574, z: 3325, level: 1 }, to: { x: 2449, z: 3482, level: 1 }, radius: 4, budgetMs: 300_000 },
    { name: 'falador-house-L1→rimmington-house-L1', from: { x: 3036, z: 3347, level: 1 }, to: { x: 2970, z: 3215, level: 1 }, radius: 4, budgetMs: 300_000 },
    { name: 'draynor-bank→fishing-guild-shop', from: { x: 3092, z: 3243, level: 0 }, to: { x: 2596, z: 3399, level: 0 }, radius: 4, budgetMs: 300_000 },
    { name: 'varrock-bank-L1→fishing-guild-L1', from: { x: 3250, z: 3419, level: 1 }, to: { x: 2574, z: 3325, level: 1 }, radius: 4, budgetMs: 300_000 },
    { name: 'falador-house-L1→portsarim-house-L1', from: { x: 3040, z: 3364, level: 1 }, to: { x: 3015, z: 3205, level: 1 }, radius: 4, budgetMs: 300_000 },
    { name: 'duel-arena-bank→shantay-bank', from: { x: 3382, z: 3269, level: 0 }, to: { x: 3309, z: 3120, level: 0 }, radius: 4, budgetMs: 240_000 },
    { name: 'edgeville-bank→varrock-west-bank', from: { x: 3094, z: 3491, level: 0 }, to: { x: 3185, z: 3436, level: 0 } },
    { name: 'edgeville→varrock-castle-L2', from: { x: 3094, z: 3491, level: 0 }, to: { x: 3213, z: 3474, level: 2 } },
    { name: 'edgeville→draynor-manor-L1', from: { x: 3094, z: 3491, level: 0 }, to: { x: 3108, z: 3364, level: 1 } },
    { name: 'edgeville→lumbridge-cellar', from: { x: 3094, z: 3491, level: 0 }, to: { x: 3209, z: 9616, level: 0 } },
    { name: 'edgeville→alkharid-bank(toll)', from: { x: 3094, z: 3491, level: 0 }, to: { x: 3269, z: 3167, level: 0 } },
    { name: 'edgeville→falador-castle-L2', from: { x: 3094, z: 3491, level: 0 }, to: { x: 2960, z: 3339, level: 2 } },
    { name: 'edgeville→edgeville-dungeon', from: { x: 3094, z: 3491, level: 0 }, to: { x: 3097, z: 9867, level: 0 } },
    { name: 'varrock→champions-guild', from: { x: 3185, z: 3436, level: 0 }, to: { x: 3191, z: 3363, level: 0 } },
    { name: 'falador→taverley(gate)', from: { x: 2946, z: 3368, level: 0 }, to: { x: 2885, z: 3449, level: 0 } },
    { name: 'varrock→seers-bank', from: { x: 3185, z: 3436, level: 0 }, to: { x: 2725, z: 3491, level: 0 }, budgetMs: 400_000 },
    { name: 'portsarim→karamja(ship)', from: { x: 3027, z: 3222, level: 0 }, to: { x: 2925, z: 3176, level: 0 }, budgetMs: 240_000 },
    { name: 'varrock→barb-village-basement', from: { x: 3185, z: 3436, level: 0 }, to: { x: 3081, z: 9955, level: 0 } },
    // Why: every route into Morytania crosses the Paterdomus tunnel and the Salve barrier, so this must fail fast without Priest in Peril and walk through with it (CHEATS=~cq, which also takes barrier access).
    { name: 'varrock→canifis(priest-in-peril)', from: { x: 3253, z: 3420, level: 0 }, to: { x: 3499, z: 3506, level: 0 }, radius: 6, budgetMs: 420_000 }
];

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1]! : 'out/route-walk-live.json';
const ONLY = process.env.ROUTES ? new Set(process.env.ROUTES.split(',').map(Number)) : null;
const SPEED = process.env.SPEED ? Number(process.env.SPEED) : null;
const DEFAULT_BUDGET_MS = Number(process.env.BUDGET_MS ?? 180_000);
/** Extra cheats to send after login, comma separated — e.g. CHEATS=~cq for every quest. */
const CHEATS = (process.env.CHEATS ?? '').split(',').map(c => c.trim()).filter(Boolean);

type Abi = {
    __rs2b0t: {
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: {
            walkResilient(dest: Tile, opts: Record<string, unknown>): Promise<boolean>;
        };
        WalkExecutor: { lastOutcome: string | null };
        Game: { tile(): Tile | null };
        registerScript(m: { name: string; create(): unknown }): void;
    };
    rs2b0t: {
        runner: { state: string; start(m: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
        reader: { worldTile(): Tile | null };
    };
    __walkProbe?: { done: boolean; ok: boolean; outcome: string | null; log: string[]; err?: string };
};

async function runRoute(page: Page, r: Route): Promise<Record<string, unknown>> {
    const budget = r.budgetMs ?? DEFAULT_BUDGET_MS;
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop('route-walk-live: next route');
        } catch {
            /* nothing running */
        }
    });
    await page.waitForTimeout(500);
    if (!(await teleTo(page, r.from, 6, 25_000))) {
        return { name: r.name, ok: false, verdict: 'seed-failed', reason: 'tele to start failed' };
    }
    await page.waitForTimeout(1200);

    const started = Date.now();
    await page.evaluate(
        ([dest, radius, budgetMs]) => {
            const g = globalThis as never as Abi;
            const abi = g.__rs2b0t;
            const res: NonNullable<Abi['__walkProbe']> = { done: false, ok: false, outcome: null, log: [] };
            g.__walkProbe = res;
            class WalkProbe extends abi.LoopingBot {
                private ran = false;

                override async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    try {
                        res.ok = await abi.Traversal.walkResilient(dest as Tile, {
                            radius: radius as number,
                            attempts: 4,
                            timeoutMs: budgetMs as number,
                            log: (m: string) => {
                                res.log.push(m);
                                this.log(m);
                            }
                        });
                        res.outcome = abi.WalkExecutor.lastOutcome;
                    } catch (e) {
                        res.err = String(e);
                    }
                    res.done = true;
                    return 5000;
                }
            }
            abi.registerScript({ name: 'WalkProbe', create: () => new WalkProbe() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get('WalkProbe'));
        },
        [r.to, r.radius ?? 2, budget] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as Abi).__walkProbe?.done === true, undefined, { timeout: budget + 60_000 })
        .catch(() => undefined);
    const probe = await page.evaluate(() => (globalThis as never as Abi).__walkProbe ?? null);
    const at = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.reader.worldTile());
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop('route-walk-live: route finished');
        } catch {
            /* already stopped */
        }
    });
    const dist = at ? Math.max(Math.abs(at.x - r.to.x), Math.abs(at.z - r.to.z)) : -1;
    const arrived = !!probe?.ok && at?.level === r.to.level && dist <= (r.radius ?? 2) + 2;
    return {
        name: r.name,
        ok: arrived,
        verdict: arrived ? 'ARRIVED' : probe?.done ? 'FAILED' : 'TIMEOUT',
        outcome: probe?.outcome ?? null,
        ms: Date.now() - started,
        at,
        dist,
        err: probe?.err,
        log: (probe?.log ?? []).slice(-60)
    };
}

const browser = await launchBrowser();
const results: Record<string, unknown>[] = [];
try {
    const page = await browser.newPage();
    const user = `nw${Date.now().toString(36).slice(-6)}`;
    await mainlandAccount(page, base, user);
    await cheatQuiet(page, '~maxme');
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'give coins 5000');
    if (CHEATS.length > 0) {
        for (const c of CHEATS) {
            console.log(`cheat: ${c}`);
            await cheatQuiet(page, c, 2000);
        }
        // The quest tab only recolours from the login payload, so a setvar seed is
        // invisible to Quests.status (and therefore to WorldState) until a relog.
        await relog(page, user);
        await maxmeAndClearDialogs(page);
    }
    if (SPEED !== null) {
        await cheatQuiet(page, `speed ${SPEED}`);
    }
    for (let i = 0; i < ROUTES.length; i++) {
        if (ONLY && !ONLY.has(i)) {
            continue;
        }
        const r = ROUTES[i]!;
        const out = await runRoute(page, r);
        results.push({ idx: i, ...out });
        console.log(`[${i}] ${out.verdict} ${r.name} (${Math.round(Number(out.ms ?? 0) / 1000)}s) outcome=${out.outcome} dist=${out.dist}`);
    }
} finally {
    await browser.close();
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
const bad = results.filter(r => r.verdict !== 'ARRIVED');
console.log(`\n${results.length - bad.length}/${results.length} ARRIVED`);
for (const b of bad) {
    console.log(`  ${b.verdict} [${b.idx}] ${b.name} outcome=${b.outcome} dist=${b.dist}`);
    for (const l of (b.log as string[]) ?? []) {
        console.log(`      · ${l}`);
    }
}
console.log(`wrote ${OUT}`);
