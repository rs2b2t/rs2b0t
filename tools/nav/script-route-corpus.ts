/**
 * Pack stress corpus ripped from in-tree script / nav data (not a hand-maintained
 * mega-JSON). Sources of truth:
 *   - BANK_LOCATIONS          (bank stands every bot returns to)
 *   - WALK_DESTINATIONS       (WalkToBot / common tele hubs)
 *   - NAV_TARGETS             (per-script stands from coverage tooling)
 *   - tools/nav/mainland-routes.json  (curated F2P/mine legs)
 *
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --explain
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --write
 *
 * Preload is required: BankLocations pulls a tiny bit of client surface (happy-dom).
 * Live walk of a sample remains operator-only (nav-v2-stress-live) — this tool is pack-only.
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { BANK_LOCATIONS } from '#/bot/api/BankLocations.js';
import { WALK_DESTINATIONS } from '#/bot/api/WalkDestinations.js';
import doorsJson from '#/bot/nav/data/doors.json';
import { NAV_TARGETS } from '#/bot/nav/data/navTargets.js';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transportsJson from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '#/bot/nav/PathFinder.js';
import { formatHops } from '#/bot/nav/v2/hops.js';

export interface ScriptRoute {
    id: string;
    from: NavPoint;
    to: NavPoint;
    note: string;
    /** provenance for audits */
    source: string;
}

/** Pack metrics for ranking “hard” routes (no tele catalog — pure graph walk). */
export interface RankedScriptRoute extends ScriptRoute {
    cost: number;
    expanded: number;
    hops: number;
    cheb: number;
    ms: number;
    /** Higher = harder. Primary: path cost; tie-break: expansions, then hops. */
    difficulty: number;
}

export function difficultyScore(m: { cost: number; expanded: number; hops: number; cheb: number }): number {
    // Cost dominates (tile + door/transport weights). Expansions capture “search thrash”.
    return m.cost * 1000 + Math.min(m.expanded, 500_000) + m.hops * 10 + m.cheb;
}

export function rankHardest(rows: RankedScriptRoute[], n: number): RankedScriptRoute[] {
    return [...rows].sort((a, b) => b.difficulty - a.difficulty).slice(0, Math.max(0, n));
}

const cheb = (a: NavPoint, b: NavPoint): number =>
    a.level !== b.level ? 9999 : Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

const keyOf = (p: NavPoint): string => `${p.x},${p.z},${p.level}`;

/** Build the route list — pure, unit-testable. */
export function buildScriptRoutes(opts?: { maxBankPairs?: number }): ScriptRoute[] {
    const maxBankPairs = opts?.maxBankPairs ?? 24;
    const routes: ScriptRoute[] = [];
    const seen = new Set<string>();

    const add = (id: string, from: NavPoint, to: NavPoint, note: string, source: string): void => {
        if (from.x === to.x && from.z === to.z && from.level === to.level) {
            return;
        }
        const k = `${keyOf(from)}>${keyOf(to)}`;
        if (seen.has(k)) {
            return;
        }
        seen.add(k);
        routes.push({ id, from: { ...from }, to: { ...to }, note, source });
    };

    // 1) Curated mainland legs (already operator-vetted).
    const mainlandPath = path.join(process.cwd(), 'tools/nav/mainland-routes.json');
    if (fs.existsSync(mainlandPath)) {
        const corpus = JSON.parse(fs.readFileSync(mainlandPath, 'utf8')) as {
            routes: { id: string; from: NavPoint; to: NavPoint; note: string }[];
        };
        for (const r of corpus.routes) {
            add(r.id, r.from, r.to, r.note, 'mainland-routes.json');
        }
    }

    // 2) WalkToBot hub mesh (small N — full directed pairs).
    for (let i = 0; i < WALK_DESTINATIONS.length; i++) {
        for (let j = 0; j < WALK_DESTINATIONS.length; j++) {
            if (i === j) {
                continue;
            }
            const a = WALK_DESTINATIONS[i]!;
            const b = WALK_DESTINATIONS[j]!;
            add(
                `WALK-${i}-${j}`,
                { x: a.tile.x, z: a.tile.z, level: a.tile.level },
                { x: b.tile.x, z: b.tile.z, level: b.tile.level },
                `${a.name} → ${b.name}`,
                'WALK_DESTINATIONS'
            );
        }
    }

    // 3) Bank hub mesh (undirected unique pairs, nearest-first budget).
    const banks = BANK_LOCATIONS.map(b => ({
        name: b.name,
        tile: { x: b.tile.x, z: b.tile.z, level: b.tile.level } as NavPoint
    }));
    type Pair = { i: number; j: number; d: number };
    const pairs: Pair[] = [];
    for (let i = 0; i < banks.length; i++) {
        for (let j = i + 1; j < banks.length; j++) {
            pairs.push({ i, j, d: cheb(banks[i]!.tile, banks[j]!.tile) });
        }
    }
    pairs.sort((a, b) => a.d - b.d);
    let bankN = 0;
    for (const p of pairs) {
        if (bankN >= maxBankPairs) {
            break;
        }
        const a = banks[p.i]!;
        const b = banks[p.j]!;
        add(`BANK-${p.i}-${p.j}`, a.tile, b.tile, `${a.name} bank → ${b.name} bank`, 'BANK_LOCATIONS');
        add(`BANK-${p.j}-${p.i}`, b.tile, a.tile, `${b.name} bank → ${a.name} bank`, 'BANK_LOCATIONS');
        bankN++;
    }

    // 4) Per-script NAV_TARGETS: chain stands for the same bot (as scripts hop camp→bank).
    const byBot = new Map<string, { label: string; tile: NavPoint }[]>();
    for (const t of NAV_TARGETS) {
        if (t.expected === 'island') {
            continue; // disconnected / special plane
        }
        const list = byBot.get(t.bot) ?? [];
        list.push({ label: t.label, tile: t.tile });
        byBot.set(t.bot, list);
    }
    for (const [bot, stands] of byBot) {
        for (let i = 0; i < stands.length; i++) {
            for (let j = 0; j < stands.length; j++) {
                if (i === j) {
                    continue;
                }
                const a = stands[i]!;
                const b = stands[j]!;
                // Skip huge cross-map pairs within multi-bot labels — keep cheb ≤ 200
                // or same bot short hops (camp↔bank).
                const d = cheb(a.tile, b.tile);
                if (d > 220 && !a.label.toLowerCase().includes('bank') && !b.label.toLowerCase().includes('bank')) {
                    continue;
                }
                add(
                    `BOT-${bot.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 24)}-${i}-${j}`,
                    a.tile,
                    b.tile,
                    `${bot}: ${a.label} → ${b.label}`,
                    'NAV_TARGETS'
                );
            }
        }
    }

    // 5) Each NAV_TARGET → nearest bank (the commute every gatherer/fighter does).
    for (let ti = 0; ti < NAV_TARGETS.length; ti++) {
        const t = NAV_TARGETS[ti]!;
        if (t.expected === 'island') {
            continue;
        }
        let best: { name: string; tile: NavPoint; d: number } | null = null;
        for (const b of banks) {
            const d = cheb(t.tile, b.tile);
            if (!best || d < best.d) {
                best = { name: b.name, tile: b.tile, d };
            }
        }
        if (!best || best.d === 0 || best.d > 400) {
            continue;
        }
        add(
            `COMMUTE-${ti}`,
            t.tile,
            best.tile,
            `${t.bot} ${t.label} → nearest bank ${best.name}`,
            'NAV_TARGETS→BANK'
        );
        add(
            `COMMUTE-${ti}-R`,
            best.tile,
            t.tile,
            `${best.name} bank → ${t.bot} ${t.label}`,
            'BANK→NAV_TARGETS'
        );
    }

    return routes;
}

// ── CLI (only when executed as a script — importable for unit tests) ─────
const isMain =
    typeof import.meta !== 'undefined'
    && typeof Bun !== 'undefined'
    && import.meta.path === Bun.main;

if (isMain) {
    const explain = process.argv.includes('--explain');
    const write = process.argv.includes('--write');
    const limitArg = process.argv.find(a => a.startsWith('--limit='));
    const hardestArg = process.argv.find(a => a.startsWith('--hardest='));
    const limit = limitArg ? Number(limitArg.split('=')[1]) : Number(process.env.LIMIT || 0);
    const hardestN = hardestArg
        ? Number(hardestArg.split('=')[1])
        : Number(process.env.HARDEST || 0);

    const allRoutes = buildScriptRoutes();
    const routes = limit > 0 ? allRoutes.slice(0, limit) : allRoutes;

    if (write) {
        const outPath = path.join(process.cwd(), 'tools/nav/script-routes.generated.json');
        fs.writeFileSync(
            outPath,
            JSON.stringify(
                {
                    description:
                        'Generated from BANK_LOCATIONS + WALK_DESTINATIONS + NAV_TARGETS + mainland-routes.json. Do not hand-edit — run script-route-corpus.ts --write.',
                    generatedAt: new Date().toISOString(),
                    count: allRoutes.length,
                    routes: allRoutes
                },
                null,
                2
            )
        );
        console.log(`wrote ${allRoutes.length} routes → ${outPath}`);
    }

    const packPath = 'out/collision.lcnav.gz';
    if (!fs.existsSync(packPath)) {
        console.error(`missing ${packPath} — run collision pack build first`);
        process.exit(2);
    }

    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const finder = new PathFinder(bytes);
    finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson as never);

    let fail = 0;
    let pass = 0;
    const ranked: RankedScriptRoute[] = [];
    const t0 = performance.now();

    // Pure pack walk (no tele catalog) so “hard” means long graph cost, not tele shortcuts.
    for (const r of routes) {
        const started = performance.now();
        const outcome = finder.findPath(r.from, r.to, { policy: { useTeleports: false } });
        const ms = performance.now() - started;
        if (!outcome.ok) {
            console.log(`FAIL ${r.id} [${r.source}] ${r.note}: ${outcome.reason} (${ms.toFixed(1)}ms)`);
            fail++;
            continue;
        }
        pass++;
        const chebDist = cheb(r.from, r.to);
        const row: RankedScriptRoute = {
            ...r,
            cost: outcome.cost,
            expanded: outcome.expanded,
            hops: outcome.hops.length,
            cheb: chebDist,
            ms,
            difficulty: difficultyScore({
                cost: outcome.cost,
                expanded: outcome.expanded,
                hops: outcome.hops.length,
                cheb: chebDist
            })
        };
        ranked.push(row);
        if (explain) {
            console.log(
                `PASS ${r.id} cost=${outcome.cost} exp=${outcome.expanded} hops=${outcome.hops.length} ${ms.toFixed(1)}ms — ${r.note}`
            );
            if (outcome.hops.length) {
                console.log(formatHops(outcome.hops));
            }
        }
    }

    const elapsed = performance.now() - t0;
    console.log(
        `\nscript-route-corpus: ${pass} pass, ${fail} fail, ${routes.length} run / ${allRoutes.length} built, ${elapsed.toFixed(0)}ms`
    );

    const nHard = hardestN > 0 ? hardestN : 25;
    const hardest = rankHardest(ranked, nHard);
    console.log(`\nhardest ${hardest.length} (by pack cost / expansions, no teles):`);
    for (let i = 0; i < hardest.length; i++) {
        const h = hardest[i]!;
        console.log(
            `  ${String(i + 1).padStart(2)}. cost=${h.cost} exp=${h.expanded} hops=${h.hops} cheb=${h.cheb} ${h.id} — ${h.note}`
        );
    }

    const hardPath = path.join(process.cwd(), 'tools/nav/script-routes.hardest.json');
    // Always refresh precalc when a full (or limit) pack run completes — used by live HARD=1.
    if (hardestN > 0 || !limit) {
        fs.writeFileSync(
            hardPath,
            JSON.stringify(
                {
                    description:
                        'Precalc: hardest pack paths (useTeleports:false). Regenerate with script-route-corpus.ts [--hardest=N]. Live: HARD=1 bun tools/nav-script-routes-live.ts',
                    generatedAt: new Date().toISOString(),
                    metric: 'difficulty = cost*1000 + min(expanded,500k) + hops*10 + cheb',
                    teleports: false,
                    count: hardest.length,
                    routes: hardest
                },
                null,
                2
            )
        );
        console.log(`\nwrote ${hardest.length} hardest routes → ${hardPath}`);
    }

    process.exit(fail === 0 ? 0 : 1);
}
