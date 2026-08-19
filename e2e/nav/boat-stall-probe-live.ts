/** Diagnostic: time every walker log line across a boat crossing to locate the post-animation stall.
 *  Prints per-line deltas and the player tile at each line, so the gap after the map animation is visible. */

//   bun e2e/nav/boat-stall-probe-live.ts --base http://localhost:8890
//   ROUTES=0,1 bun e2e/nav/boat-stall-probe-live.ts
import fs from 'node:fs';

import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, parseArgs } from '../lib/harness.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs, teleTo } from '../tutorial/harness.js';

type Tile = { x: number; z: number; level: number };

interface Route {
    name: string;
    from: Tile;
    to: Tile;
    radius?: number;
    budgetMs?: number;
}

const ROUTES: Route[] = [
    { name: 'portsarim→musa(ship)', from: { x: 3027, z: 3222, level: 0 }, to: { x: 2925, z: 3176, level: 0 }, budgetMs: 240_000 },
    { name: 'musa→portsarim(ship)', from: { x: 2925, z: 3176, level: 0 }, to: { x: 3027, z: 3222, level: 0 }, budgetMs: 240_000 },
    { name: 'ardougne→brimhaven(ship)', from: { x: 2673, z: 3275, level: 0 }, to: { x: 2779, z: 3212, level: 0 }, budgetMs: 240_000 },
    { name: 'brimhaven→ardougne(ship)', from: { x: 2779, z: 3212, level: 0 }, to: { x: 2673, z: 3275, level: 0 }, budgetMs: 240_000 }
];

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const OUT = 'out/boat-stall-probe.json';
const ONLY = process.env.ROUTES ? new Set(process.env.ROUTES.split(',').map(Number)) : null;

type Entry = { t: number; m: string; at: Tile | null };

type Abi = {
    __rs2b0t: {
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: { walkResilient(dest: Tile, opts: Record<string, unknown>): Promise<boolean> };
        WalkExecutor: { lastOutcome: string | null };
        Game: { tile(): Tile | null };
        registerScript(m: { name: string; create(): unknown }): void;
    };
    rs2b0t: {
        runner: { state: string; start(m: unknown): void; stop(reason: string): void };
        registry: { get(n: string): unknown };
        reader: { worldTile(): Tile | null };
    };
    __probe?: { done: boolean; ok: boolean; outcome: string | null; log: Entry[]; err?: string };
};

async function runRoute(page: Page, r: Route): Promise<Record<string, unknown>> {
    const budget = r.budgetMs ?? 240_000;
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop('boat-stall-probe: next route');
        } catch {
            /* nothing running */
        }
    });
    await page.waitForTimeout(500);
    if (!(await teleTo(page, r.from, 6, 25_000))) {
        return { name: r.name, ok: false, verdict: 'seed-failed' };
    }
    await page.waitForTimeout(1500);

    const started = Date.now();
    await page.evaluate(
        ([dest, radius, budgetMs]) => {
            const g = globalThis as never as Abi;
            const abi = g.__rs2b0t;
            const res: NonNullable<Abi['__probe']> = { done: false, ok: false, outcome: null, log: [] };
            g.__probe = res;
            const t0 = performance.now();
            class BoatProbe extends abi.LoopingBot {
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
                                res.log.push({ t: Math.round(performance.now() - t0), m, at: abi.Game.tile() });
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
            abi.registerScript({ name: 'BoatProbe', create: () => new BoatProbe() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get('BoatProbe'));
        },
        [r.to, r.radius ?? 4, budget] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as Abi).__probe?.done === true, undefined, { timeout: budget + 60_000 })
        .catch(() => undefined);
    const probe = await page.evaluate(() => (globalThis as never as Abi).__probe ?? null);
    const at = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.reader.worldTile());
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop('boat-stall-probe: route finished');
        } catch {
            /* already stopped */
        }
    });
    return {
        name: r.name,
        ok: !!probe?.ok,
        verdict: probe?.ok ? 'ARRIVED' : probe?.done ? 'FAILED' : 'TIMEOUT',
        outcome: probe?.outcome ?? null,
        ms: Date.now() - started,
        at,
        err: probe?.err,
        log: probe?.log ?? []
    };
}

const client = deployIsolatedClient('boatstall');
const browser = await launchBrowser();
const results: Record<string, unknown>[] = [];
try {
    const page = await browser.newPage();
    const user = `bs${Date.now().toString(36).slice(-6)}`;
    await mainlandAccount(page, base, user, client.page);
    await cheatQuiet(page, '~maxme');
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'give coins 5000');
    for (let i = 0; i < ROUTES.length; i++) {
        if (ONLY && !ONLY.has(i)) {
            continue;
        }
        const r = ROUTES[i]!;
        const out = await runRoute(page, r);
        results.push({ idx: i, ...out });
        console.log(`\n[${i}] ${out.verdict} ${r.name} (${Math.round(Number(out.ms ?? 0) / 1000)}s) outcome=${out.outcome}`);
        const log = (out.log as Entry[]) ?? [];
        let prev = 0;
        for (const e of log) {
            const d = e.t - prev;
            prev = e.t;
            const flag = d >= 3000 ? ' <<<< GAP' : '';
            const at = e.at ? `(${e.at.x},${e.at.z},L${e.at.level})` : '(?)';
            console.log(`   +${String(e.t).padStart(6)}ms  d=${String(d).padStart(6)}ms ${at.padEnd(18)} ${e.m}${flag}`);
        }
    }
} finally {
    await browser.close();
    client.cleanup();
}

fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
console.log(`wrote ${OUT}`);

// Why: the stall this harness exists for shows up as a disembark loc missed while the landing scene rebuilds, so a rescan line is a failure even when the leg still arrives.
const rescans = (r: Record<string, unknown>): number =>
    ((r.log as Entry[]) ?? []).filter(e => /not found near/.test(e.m)).length;
const bad = results.filter(r => r.verdict !== 'ARRIVED' || rescans(r) > 0);
for (const b of bad) {
    console.log(`  ${b.verdict} [${b.idx}] ${b.name} — ${rescans(b)} post-landing rescan(s)`);
}
if (bad.length > 0) {
    console.log(`FAIL (${results.length - bad.length}/${results.length} legs clean)`);
    process.exit(1);
}
console.log(`PASS (${results.length}/${results.length} legs clean, no post-landing rescan)`);
