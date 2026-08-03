/**
 * Pack stress corpus ripped from in-tree script / nav data (not a hand-maintained
 * mega-JSON). Sources of truth:
 *   - BANK_LOCATIONS          (bank stands every bot returns to)
 *   - WALK_DESTINATIONS       (WalkToBot / common tele hubs)
 *   - NAV_TARGETS             (per-script stands from coverage tooling)
 *   - tools/nav/mainland-routes.json  (curated F2P/mine legs)
 *
 * **Path dedupe (what matters for stress):**
 *   1. Exact from→to once at build time.
 *   2. Optional near-endpoint collapse (`--endpoint-radius`, default 3) for
 *      obvious generator twins (BOT camp↔bank vs COMMUTE).
 *   3. After pack A*, collapse routes whose **journey signature** matches —
 *      end map-square + hop sequence (not start). Pure-walks into the same
 *      region collapse (all *→Rellekka walk → one HARD leg); tele vs walk stay
 *      separate.
 *
 * Generated JSON / hardest list are written **after** pack journey dedupe.
 * **Hardest ranking uses teleports by default** (full runes + magic 99 WorldState),
 * matching live v2 stress. Pass `--no-tele` for pure-walk cost ranking only.
 *
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --write
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --hardest=25
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --no-tele --hardest=25
 *   bun --preload ./test/setup-dom.ts tools/nav/script-route-corpus.ts --endpoint-radius=0 --corridor-grid=32
 *
 * Preload is required: BankLocations pulls a tiny bit of client surface (happy-dom).
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { BANK_LOCATIONS } from '#/bot/api/BankLocations.js';
import { WALK_DESTINATIONS } from '#/bot/api/WalkDestinations.js';
import { NAV_TARGETS } from '#/bot/nav/data/navTargets.js';
import { PathFinder, type NavPoint } from '#/bot/nav/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/nav/loadTransportGraph.js';
import { formatHops } from '#/bot/nav/v2/hops.js';
import type { PathPolicy } from '#/bot/nav/v2/types.js';
import type { WorldStateData } from '#/bot/nav/v2/worldStateData.js';

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
    /** Journey fingerprint from pack A* (destination map-square). */
    corridor?: string;
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

/**
 * Prefer curated / hub sources when two generators emit nearly the same leg
 * (e.g. BOT camp↔bank vs COMMUTE to nearest bank — same path for stress).
 * Higher = keep. Reverse directions are never collapsed into each other.
 */
const SOURCE_PRIORITY: Record<string, number> = {
    'mainland-routes.json': 100,
    WALK_DESTINATIONS: 80,
    BANK_LOCATIONS: 70,
    'NAV_TARGETS→BANK': 55,
    'BANK→NAV_TARGETS': 55,
    NAV_TARGETS: 40
};

export function sourcePriority(source: string): number {
    return SOURCE_PRIORITY[source] ?? 10;
}

/** Same directed leg if both endpoints lie within `radius` (same levels). */
export function sameDirectedPath(a: ScriptRoute, b: ScriptRoute, radius: number): boolean {
    if (a.from.level !== b.from.level || a.to.level !== b.to.level) {
        return false;
    }
    return cheb(a.from, b.from) <= radius && cheb(a.to, b.to) <= radius;
}

/**
 * Drop near-duplicate **endpoints** across sources (generator twins).
 * Does not know the actual walk corridor — see `pathCorridorSignature`.
 */
export function dedupePaths(routes: ScriptRoute[], radius = 3): ScriptRoute[] {
    const sorted = [...routes].sort((a, b) => {
        const dp = sourcePriority(b.source) - sourcePriority(a.source);
        if (dp !== 0) {
            return dp;
        }
        return a.id.localeCompare(b.id);
    });
    const kept: ScriptRoute[] = [];
    for (const r of sorted) {
        if (kept.some(k => sameDirectedPath(k, r, radius))) {
            continue;
        }
        kept.push(r);
    }
    return kept;
}

export type PathHopLike = {
    kind: string;
    locName?: string;
    action?: string;
    from: NavPoint;
    to: NavPoint;
};

export type WaypointLike = { x: number; z: number; level: number };

/**
 * Journey fingerprint for stress / HARD dedupe.
 *
 * **End map-square + hop sequence only** — not the start tile. Otherwise the
 * HARD list is flooded with near-identical pure-walks into the same region
 * (Varrock/Falador/… → Rellekka all cost≈295, hops=1).
 *
 * - Same pure-walk destination → one representative (keep hardest).
 * - Tele vs walk (or different hop kinds) stay distinct.
 * - Reverse legs stay distinct (destination map-square swaps).
 *
 * `sampleEvery` is reserved for future walk-corridor sampling; default
 * `grid` **64** = one map square.
 */
export function pathCorridorSignature(
    waypoints: WaypointLike[],
    hops: PathHopLike[],
    opts?: { grid?: number; sampleEvery?: number }
): string {
    const grid = Math.max(1, opts?.grid ?? 64);
    void opts?.sampleEvery;

    if (waypoints.length === 0) {
        return 'empty';
    }

    const end = waypoints[waypoints.length - 1]!;
    const hopKey =
        hops.length === 0
            ? 'walk'
            : hops
                  .map(h => {
                      const name = (h.locName ?? h.kind).toLowerCase().replace(/\s+/g, '_');
                      return `${h.kind}:${name}`;
                  })
                  .join('+');

    return [`e:${end.level}:${(end.x / grid) | 0}:${(end.z / grid) | 0}`, `h:${hopKey}`].join('|');
}

/**
 * Keep one ranked route per journey signature. Prefer higher difficulty (the
 * HARD representative), then source priority as a tie-break.
 */
export function dedupeByCorridor<T extends ScriptRoute & { corridor: string; difficulty: number }>(
    rows: T[]
): T[] {
    const sorted = [...rows].sort((a, b) => {
        if (b.difficulty !== a.difficulty) {
            return b.difficulty - a.difficulty;
        }
        const dp = sourcePriority(b.source) - sourcePriority(a.source);
        if (dp !== 0) {
            return dp;
        }
        return a.id.localeCompare(b.id);
    });
    const seen = new Set<string>();
    const kept: T[] = [];
    for (const r of sorted) {
        if (seen.has(r.corridor)) {
            continue;
        }
        seen.add(r.corridor);
        kept.push(r);
    }
    return kept;
}

/** Build the route list — pure, unit-testable. */
export function buildScriptRoutes(opts?: { maxBankPairs?: number; pathDedupeRadius?: number }): ScriptRoute[] {
    const maxBankPairs = opts?.maxBankPairs ?? 24;
    /** Endpoint near-dedupe only; 0 = exact from→to only. Corridor dedupe is pack-time. */
    const pathDedupeRadius = opts?.pathDedupeRadius ?? 3;
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

    // 4) Each NAV_TARGET → nearest bank (the commute every gatherer/fighter does).
    //    Before full bot meshes so path-dedupe prefers COMMUTE over redundant BOT-*-bank legs.
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

    // 5) Per-script NAV_TARGETS: chain stands for the same bot (as scripts hop camp→bank).
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

    // Collapse near-identical directed legs across generators (not reverse pairs).
    return pathDedupeRadius <= 0 ? routes : dedupePaths(routes, pathDedupeRadius);
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
    // legacy alias
    const dedupeArg =
        process.argv.find(a => a.startsWith('--endpoint-radius='))
        ?? process.argv.find(a => a.startsWith('--dedupe-radius='));
    const gridArg = process.argv.find(a => a.startsWith('--corridor-grid='));
    const sampleArg = process.argv.find(a => a.startsWith('--corridor-sample='));
    const useTele =
        !process.argv.includes('--no-tele')
        && process.env.NO_TELE !== '1'
        && process.env.NO_TELE !== 'true';
    const distanceBeforeTeleport = Number(
        process.argv.find(a => a.startsWith('--distanceBeforeTeleport='))?.split('=')[1]
        ?? process.env.DISTANCE_BEFORE_TELEPORT
        ?? 40
    );
    const limit = limitArg ? Number(limitArg.split('=')[1]) : Number(process.env.LIMIT || 0);
    const hardestN = hardestArg
        ? Number(hardestArg.split('=')[1])
        : Number(process.env.HARDEST || 0);
    const endpointRadius = dedupeArg
        ? Number(dedupeArg.split('=')[1])
        : Number(process.env.ENDPOINT_RADIUS ?? process.env.DEDUPE_RADIUS ?? 3);
    // End-region size for journey keys (64 = map square). Coarser = more collapse.
    const corridorGrid = gridArg
        ? Number(gridArg.split('=')[1])
        : Number(process.env.CORRIDOR_GRID ?? 64);
    // Kept for CLI/meta compatibility; journey key does not sample the polyline.
    const corridorSample = sampleArg
        ? Number(sampleArg.split('=')[1])
        : Number(process.env.CORRIDOR_SAMPLE ?? 12);

    const rawCount = buildScriptRoutes({ pathDedupeRadius: 0 }).length;
    const seedRoutes = buildScriptRoutes({ pathDedupeRadius: endpointRadius });
    const routes = limit > 0 ? seedRoutes.slice(0, limit) : seedRoutes;
    console.log(
        `seeds: ${seedRoutes.length} after endpoint-radius=${endpointRadius}`
        + ` (raw ${rawCount}); pack will corridor-dedupe (grid=${corridorGrid}, sample=${corridorSample})`
    );
    console.log(
        useTele
            ? `path cost: with tele catalog (magic 99 + runes, distanceBeforeTeleport=${distanceBeforeTeleport})`
            : 'path cost: pure walk only (--no-tele)'
    );

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
    loadDefaultNavEdges(finder);

    let fail = 0;
    let pass = 0;
    const ranked: RankedScriptRoute[] = [];
    const t0 = performance.now();

    // Match live v2 / maxme stress: teles + skill-gated guild doors open.
    // Magic-only was wrong: Fishing Guild doors need fishing 68 (specialRequires).
    // Missing skills default to 0 → fail-closed → A* burns the expansion budget
    // on real script targets (BANK_* → Fishing Guild, ShopRunner feather stand).
    const maxedSkills: Record<string, number> = {
        magic: 99,
        Magic: 99,
        fishing: 99,
        Fishing: 99,
        agility: 99,
        Agility: 99,
        crafting: 99,
        Crafting: 99,
        cooking: 99,
        Cooking: 99,
        ranged: 99,
        Ranged: 99,
        mining: 99,
        Mining: 99,
        thieving: 99,
        strength: 99,
        attack: 99,
        defence: 99,
        hitpoints: 99,
        prayer: 99,
        herblore: 99,
        fletching: 99,
        woodcutting: 99,
        firemaking: 99,
        smithing: 99
    };
    const teleState: WorldStateData | undefined = useTele
        ? {
            members: true,
            skills: maxedSkills,
            quests: {
                // Journal names (+ aliases resolved in worldStateData)
                'Plague City': 'complete',
                Watchtower: 'complete',
                "Eadgar's Ruse": 'complete',
                'Rune Mysteries Quest': 'complete',
                'The Grand Tree': 'complete',
                'Tree Gnome Village': 'complete',
                'Shilo Village': 'complete'
            },
            items: {
                'Law rune': 200,
                'Air rune': 500,
                'Fire rune': 200,
                'Water rune': 200,
                'Earth rune': 200,
                // jewellery charge names matched loosely by catalog
                'Ring of dueling(8)': 1,
                'Games necklace(8)': 1,
                'Amulet of glory(4)': 1
            },
            worn: {
                "Chef's hat": 1
            },
            freeSlots: 20
        }
        : undefined;
    const policy: PathPolicy = useTele
        ? { useTeleports: true, distanceBeforeTeleport }
        : { useTeleports: false };

    for (const r of routes) {
        const started = performance.now();
        const outcome = finder.findPath(r.from, r.to, {
            policy,
            state: teleState,
            useTeleportCatalog: useTele
        });
        const ms = performance.now() - started;
        if (!outcome.ok) {
            console.log(`FAIL ${r.id} [${r.source}] ${r.note}: ${outcome.reason} (${ms.toFixed(1)}ms)`);
            fail++;
            continue;
        }
        pass++;
        const chebDist = cheb(r.from, r.to);
        const teleHops = outcome.hops.filter(h => h.kind === 'teleport').length;
        const corridor = pathCorridorSignature(outcome.waypoints, outcome.hops, {
            grid: corridorGrid,
            sampleEvery: corridorSample
        });
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
            }),
            corridor
        };
        ranked.push(row);
        if (explain) {
            console.log(
                `PASS ${r.id} cost=${outcome.cost} exp=${outcome.expanded} hops=${outcome.hops.length}`
                + ` tele=${teleHops} ${ms.toFixed(1)}ms — ${r.note}`
            );
            if (outcome.hops.length) {
                console.log(formatHops(outcome.hops));
            }
        }
    }

    // One representative per pack corridor (same journey, different seeds).
    const unique = dedupeByCorridor(
        ranked.map(r => ({ ...r, corridor: r.corridor ?? r.id }))
    );
    const corridorDropped = ranked.length - unique.length;

    const elapsed = performance.now() - t0;
    console.log(
        `\nscript-route-corpus: ${pass} pass, ${fail} fail, ${routes.length} seeds probed, `
        + `${unique.length} unique corridors (−${corridorDropped}), ${elapsed.toFixed(0)}ms`
    );

    const nHard = hardestN > 0 ? hardestN : 25;
    const hardest = rankHardest(unique, nHard);
    console.log(
        `\nhardest ${hardest.length} unique corridors `
        + `(pack cost / expansions, teles=${useTele ? 'on' : 'off'}):`
    );
    for (let i = 0; i < hardest.length; i++) {
        const h = hardest[i]!;
        console.log(
            `  ${String(i + 1).padStart(2)}. cost=${h.cost} exp=${h.expanded} hops=${h.hops} cheb=${h.cheb} ${h.id} — ${h.note}`
        );
    }

    // JSON is always the corridor-unique set (what live HARD=1 and audits should use).
    if (write || hardestN > 0 || !limit) {
        const outPath = path.join(process.cwd(), 'tools/nav/script-routes.generated.json');
        const hardPath = path.join(process.cwd(), 'tools/nav/script-routes.hardest.json');
        const meta = {
            generatedAt: new Date().toISOString(),
            endpointRadius,
            corridorGrid,
            corridorSample,
            teleports: useTele,
            distanceBeforeTeleport: useTele ? distanceBeforeTeleport : undefined,
            seedCount: routes.length,
            passCount: ranked.length,
            uniqueCorridors: unique.length
        };
        if (write || !limit) {
            const jsonRoutes = unique.map(({ corridor: _c, ...rest }) => rest);
            fs.writeFileSync(
                outPath,
                JSON.stringify(
                    {
                        description:
                            'Pack-probed paths from BANK/WALK/NAV/mainland sources. '
                            + 'Deduped by journey signature (end map-square + hop sequence). '
                            + `Path cost ${useTele ? 'with' : 'without'} tele catalog. `
                            + 'Do not hand-edit — run script-route-corpus.ts --write.',
                        ...meta,
                        count: jsonRoutes.length,
                        routes: jsonRoutes
                    },
                    null,
                    2
                )
            );
            console.log(`\nwrote ${jsonRoutes.length} unique-corridor paths → ${outPath}`);
        }
        if (hardestN > 0 || !limit) {
            const hardRoutes = hardest.map(({ corridor: _c, ...rest }) => rest);
            fs.writeFileSync(
                hardPath,
                JSON.stringify(
                    {
                        description:
                            `Hardest unique journeys (useTeleports=${useTele}). `
                            + 'Journey-deduped (end map-square + hop sequence; pure-walks to same dest collapse). '
                            + 'Regenerate with script-route-corpus.ts [--hardest=N] [--no-tele]. '
                            + 'Live: HARD=1 bun tools/nav-script-routes-live.ts',
                        metric: 'difficulty = cost*1000 + min(expanded,500k) + hops*10 + cheb',
                        ...meta,
                        count: hardRoutes.length,
                        routes: hardRoutes
                    },
                    null,
                    2
                )
            );
            console.log(`wrote ${hardRoutes.length} hardest paths → ${hardPath}`);
        }
    }

    process.exit(fail === 0 ? 0 : 1);
}
