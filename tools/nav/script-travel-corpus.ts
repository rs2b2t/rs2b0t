/** Scrape every travel endpoint scripts use and build directed legs for live nav: --list, --segment=fishing --write, --segment=clues --stats. Sources are in-tree — CLUE_DB coords plus NAV_TARGETS ClueSolver stands, FISHING/MINING/WOODCUTTING spot↔bank and cook stands, FIRE_SPOTS bank pins, CookingRanges fish-camp plans, every `new Tile(x, z, level)` in quest `areas.ts`, and the NAV_TARGETS residual under gathering-all.
 *  Segments: all | clues | quests | gathering-all | fishing | mining | woodcutting | firemaking | cooking. Endpoints are snapped off solid locs via out/collision.lcnav.gz when present. */

//   bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --list
//   bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --segment=fishing --write
//   bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --segment=clues --stats
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { FISHING_LOCATIONS } from '#/bot/data/fishingLocations.js';
import { MINING_LOCATIONS } from '#/bot/data/miningLocations.js';
import { WOODCUTTING_LOCATIONS } from '#/bot/data/woodcuttingLocations.js';
import { FISH_CAMP_COOK_PLANS, COOKING_RANGE_LOCS } from '#/bot/data/cookingRanges.js';
import { FIRE_SPOTS } from '#/bot/api/firemaking/Firemaking.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { NAV_TARGETS } from '#/bot/event/webwalk/data/navTargets.js';
import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { TALK_ANCHORS } from '#/bot/api/ai/clues/data/talkAnchors.js';
import { KILL_ANCHORS } from '#/bot/api/ai/clues/data/killAnchors.js';

export type TravelSegment =
    | 'all'
    | 'clues'
    | 'quests'
    | 'gathering-all'
    | 'fishing'
    | 'mining'
    | 'woodcutting'
    | 'firemaking'
    | 'cooking';

export const TRAVEL_SEGMENTS: readonly TravelSegment[] = [
    'all',
    'clues',
    'quests',
    'gathering-all',
    'fishing',
    'mining',
    'woodcutting',
    'firemaking',
    'cooking'
] as const;

export interface TravelPoint {
    id: string;
    tile: NavPoint;
    segment: Exclude<TravelSegment, 'all' | 'gathering-all'>;
    /** Script / catalog provenance */
    source: string;
    label: string;
}

export interface TravelRoute {
    id: string;
    from: NavPoint;
    to: NavPoint;
    note: string;
    source: string;
    /** Primary segment for filtering */
    segment: Exclude<TravelSegment, 'all'>;
    /** Also matched when SEGMENT=gathering-all */
    gathering?: boolean;
}

const keyOf = (p: NavPoint): string => `${p.x},${p.z},${p.level}`;

/** Snap search/dig/rock coords off solid locs so legs start on a stand tile. */
const ENDPOINT_SNAP_RADIUS = 3;
const COLLISION_PACK = path.join(process.cwd(), 'out', 'collision.lcnav.gz');

let endpointFinder: PathFinder | null | undefined;
let endpointSnapMissingLogged = false;

function endpointPathFinder(): PathFinder | null {
    if (endpointFinder !== undefined) {
        return endpointFinder;
    }
    try {
        let bytes: Uint8Array = new Uint8Array(fs.readFileSync(COLLISION_PACK));
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            bytes = gunzipSync(bytes);
        }
        endpointFinder = new PathFinder(bytes);
    } catch {
        endpointFinder = null;
        if (!endpointSnapMissingLogged) {
            endpointSnapMissingLogged = true;
            console.warn(
                `script-travel-corpus: missing ${COLLISION_PACK} — endpoints not snapped to walkable`
            );
        }
    }
    return endpointFinder;
}

/**
 * Script anchors (search furniture, dig spots, rocks) are often the loc tile itself
 * and unwalkable. Travel legs must start/end on a standable tile, not on the loc.
 */
export function snapTravelEndpoint(p: NavPoint, radius = ENDPOINT_SNAP_RADIUS): NavPoint {
    const finder = endpointPathFinder();
    if (!finder) {
        return { ...p };
    }
    return finder.snapWalkable(p, radius) ?? { ...p };
}

function asNav(t: { x: number; z: number; level?: number }): NavPoint {
    return { x: t.x, z: t.z, level: t.level ?? 0 };
}

function isIslandish(p: NavPoint): boolean {
    // Tutorial / deep plane / far off-grid for free path stress
    if (p.z > 9000 && p.z < 9800 && p.x > 3050 && p.x < 3150) {
        return true; // tutorial island-ish
    }
    return false;
}

/** Directed unique legs. */
export function buildTravelRoutes(): TravelRoute[] {
    const routes: TravelRoute[] = [];
    const seen = new Set<string>();

    const add = (
        id: string,
        fromRaw: NavPoint,
        toRaw: NavPoint,
        note: string,
        source: string,
        segment: Exclude<TravelSegment, 'all'>,
        gathering = false
    ): void => {
        // Prefer stand tiles: never place OD ends on solid scenery/locs.
        const from = snapTravelEndpoint(fromRaw);
        const to = snapTravelEndpoint(toRaw);
        if (from.x === to.x && from.z === to.z && from.level === to.level) {
            return;
        }
        if (isIslandish(from) || isIslandish(to)) {
            return;
        }
        // Skip absurd plane hops without a transport in between for stress OD
        if (Math.abs(from.level - to.level) > 2) {
            return;
        }
        const k = `${keyOf(from)}>${keyOf(to)}`;
        if (seen.has(k)) {
            return;
        }
        seen.add(k);
        routes.push({
            id,
            from: { ...from },
            to: { ...to },
            note,
            source,
            segment,
            gathering: gathering || segment === 'fishing' || segment === 'mining'
                || segment === 'woodcutting' || segment === 'firemaking' || segment === 'cooking'
        });
    };

    // ── Clues ──────────────────────────────────────────────────────────────
    const cluePts: { id: string; tile: NavPoint; label: string }[] = [];
    for (const [id, row] of Object.entries(CLUE_DB)) {
        const c = (row as { coord?: { x: number; z: number; level: number }; obj?: string }).coord;
        if (!c) {
            continue;
        }
        cluePts.push({
            id: `clue${id}`,
            tile: asNav(c),
            label: (row as { obj?: string }).obj ?? `clue ${id}`
        });
    }
    for (const [id, tile] of Object.entries(TALK_ANCHORS)) {
        cluePts.push({ id: `talk-${id}`, tile: asNav(tile), label: `talk ${id}` });
    }
    for (const [id, tile] of Object.entries(KILL_ANCHORS)) {
        cluePts.push({ id: `kill-${id}`, tile: asNav(tile), label: `kill ${id}` });
    }
    for (const t of NAV_TARGETS.filter(n => n.bot === 'ClueSolver' && n.expected !== 'island')) {
        cluePts.push({
            id: `nav-${t.label.replace(/\s+/g, '_')}`,
            tile: { ...t.tile },
            label: t.label
        });
    }
    // Hub mesh would be O(n²) huge — chain consecutive + each → bank-ish hubs.
    // Full mesh for small sets; for large, connect each to nearest 3 + ordered chain.
    const clueLimited = limitPoints(cluePts, 80);
    chainNeighbors(clueLimited, add, 'CLUE_DB', 'clues', false, 3);

    // ── Gathering: fishing / mining / woodcutting ──────────────────────────
    const gatherSeg = (
        locs: readonly { name: string; spot: { x: number; z: number; level: number }; bankStand: { x: number; z: number; level: number }; rangeStand?: { x: number; z: number; level: number } }[],
        segment: 'fishing' | 'mining' | 'woodcutting',
        source: string
    ): void => {
        for (let i = 0; i < locs.length; i++) {
            const loc = locs[i]!;
            const spot = asNav(loc.spot);
            const bank = asNav(loc.bankStand);
            add(`${segment}-commute-${i}`, spot, bank, `${loc.name} spot → bank`, source, segment, true);
            add(`${segment}-commute-${i}-R`, bank, spot, `${loc.name} bank → spot`, source, segment, true);
            if (loc.rangeStand) {
                const range = asNav(loc.rangeStand);
                add(`${segment}-cook-${i}`, spot, range, `${loc.name} spot → range`, source, segment, true);
                add(`${segment}-cook-${i}-R`, range, bank, `${loc.name} range → bank`, source, segment, true);
            }
        }
        // Cross-camp: consecutive camps in table (not full mesh).
        for (let i = 0; i < locs.length - 1; i++) {
            const a = asNav(locs[i]!.spot);
            const b = asNav(locs[i + 1]!.spot);
            add(`${segment}-camp-${i}-${i + 1}`, a, b, `${locs[i]!.name} → ${locs[i + 1]!.name}`, source, segment, true);
            add(`${segment}-camp-${i + 1}-${i}`, b, a, `${locs[i + 1]!.name} → ${locs[i]!.name}`, source, segment, true);
        }
    };

    gatherSeg(FISHING_LOCATIONS, 'fishing', 'FISHING_LOCATIONS');
    gatherSeg(MINING_LOCATIONS, 'mining', 'MINING_LOCATIONS');
    gatherSeg(WOODCUTTING_LOCATIONS, 'woodcutting', 'WOODCUTTING_LOCATIONS');

    // ── Firemaking ─────────────────────────────────────────────────────────
    const fireNames = Object.keys(FIRE_SPOTS);
    for (let i = 0; i < fireNames.length; i++) {
        for (let j = 0; j < fireNames.length; j++) {
            if (i === j) {
                continue;
            }
            const a = FIRE_SPOTS[fireNames[i]!]!;
            const b = FIRE_SPOTS[fireNames[j]!]!;
            add(
                `firemaking-${i}-${j}`,
                asNav(a.bank),
                asNav(b.bank),
                `${fireNames[i]} bank → ${fireNames[j]} bank`,
                'FIRE_SPOTS',
                'firemaking',
                true
            );
        }
    }

    // ── Cooking ────────────────────────────────────────────────────────────
    for (const [camp, plan] of Object.entries(FISH_CAMP_COOK_PLANS)) {
        const pier = plan.pier;
        if (pier?.stand) {
            const bank = plan.bank?.stand;
            if (bank) {
                add(
                    `cooking-${camp}-pier-bank`,
                    asNav(pier.stand),
                    asNav(bank),
                    `${camp} pier range → bank range`,
                    'FISH_CAMP_COOK_PLANS',
                    'cooking',
                    true
                );
                add(
                    `cooking-${camp}-bank-pier`,
                    asNav(bank),
                    asNav(pier.stand),
                    `${camp} bank range → pier range`,
                    'FISH_CAMP_COOK_PLANS',
                    'cooking',
                    true
                );
            }
        }
    }
    // Sample of range locs: chain every 8th to keep volume reasonable
    const ranges = COOKING_RANGE_LOCS.filter((_, i) => i % 8 === 0).slice(0, 24);
    for (let i = 0; i < ranges.length - 1; i++) {
        const a = asNav(ranges[i]!);
        const b = asNav(ranges[i + 1]!);
        add(`cooking-range-${i}`, a, b, `range ${i} → ${i + 1}`, 'COOKING_RANGE_LOCS', 'cooking', true);
    }

    // ── Quests: scrape areas.ts for Tile literals, ordered pairs within file ─
    const questDir = path.join(process.cwd(), 'src/bot/api/ai/quests/defs');
    const areaFiles = listAreaFiles(questDir);
    for (const file of areaFiles) {
        const tiles = scrapeTilesFromFile(file);
        if (tiles.length < 2) {
            continue;
        }
        const quest = path.basename(path.dirname(file));
        // Consecutive pairs + reverse (path scripts walk).
        for (let i = 0; i < tiles.length - 1; i++) {
            const a = tiles[i]!;
            const b = tiles[i + 1]!;
            add(
                `quest-${quest}-${i}-${i + 1}`,
                a,
                b,
                `${quest} areas[${i}] → [${i + 1}]`,
                `quests/${quest}/areas.ts`,
                'quests'
            );
            add(
                `quest-${quest}-${i + 1}-${i}`,
                b,
                a,
                `${quest} areas[${i + 1}] → [${i}]`,
                `quests/${quest}/areas.ts`,
                'quests'
            );
        }
    }

    // ── Residual NAV_TARGETS (non-clue) under gathering-all for completeness ─
    const residual = NAV_TARGETS.filter(
        t => t.expected !== 'island' && t.bot !== 'ClueSolver' && t.bot !== 'AIOQuester'
    );
    for (let i = 0; i < residual.length - 1; i++) {
        const a = residual[i]!;
        const b = residual[i + 1]!;
        add(
            `navtgt-${i}-${i + 1}`,
            { ...a.tile },
            { ...b.tile },
            `${a.bot} ${a.label} → ${b.bot} ${b.label}`,
            'NAV_TARGETS',
            'gathering-all',
            true
        );
    }

    return routes;
}

function listAreaFiles(dir: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(dir)) {
        return out;
    }
    const walk = (d: string): void => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, ent.name);
            if (ent.isDirectory()) {
                walk(p);
            } else if (ent.name === 'areas.ts' || ent.name.endsWith('Areas.ts')) {
                out.push(p);
            }
        }
    };
    walk(dir);
    // Also single-file quests with inline tiles (optional: scrape *.ts for Tile)
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.isFile() && ent.name.endsWith('.ts') && ent.name !== 'index.ts') {
            const p = path.join(dir, ent.name);
            const text = fs.readFileSync(p, 'utf8');
            if (/new Tile\(\s*\d+\s*,\s*\d+/.test(text) && scrapeTilesFromFile(p).length >= 2) {
                out.push(p);
            }
        }
    }
    return [...new Set(out)];
}

/** Pull `new Tile(x, z[, level])` literals in source order. */
export function scrapeTilesFromFile(filePath: string): NavPoint[] {
    const text = fs.readFileSync(filePath, 'utf8');
    const re = /new Tile\(\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(-?\d+)\s*)?\)/g;
    const out: NavPoint[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const p = {
            x: Number(m[1]),
            z: Number(m[2]),
            level: m[3] !== undefined ? Number(m[3]) : 0
        };
        const k = keyOf(p);
        if (seen.has(k)) {
            continue;
        }
        seen.add(k);
        out.push(p);
    }
    return out;
}

function limitPoints<T>(pts: T[], max: number): T[] {
    if (pts.length <= max) {
        return pts;
    }
    // Even sample to keep geographic spread.
    const step = pts.length / max;
    const out: T[] = [];
    for (let i = 0; i < max; i++) {
        out.push(pts[Math.min(pts.length - 1, Math.floor(i * step))]!);
    }
    return out;
}

function chainNeighbors(
    points: { id: string; tile: NavPoint; label: string }[],
    add: (
        id: string,
        from: NavPoint,
        to: NavPoint,
        note: string,
        source: string,
        segment: Exclude<TravelSegment, 'all'>,
        gathering?: boolean
    ) => void,
    source: string,
    segment: Exclude<TravelSegment, 'all'>,
    gathering: boolean,
    kNearest: number
): void {
    // Ordered chain
    for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        add(`${segment}-chain-${i}`, a.tile, b.tile, `${a.label} → ${b.label}`, source, segment, gathering);
        add(`${segment}-chain-${i}-R`, b.tile, a.tile, `${b.label} → ${a.label}`, source, segment, gathering);
    }
    // k-nearest mesh per point (small k keeps volume sane for 80 clue pts)
    const cheb = (a: NavPoint, b: NavPoint) =>
        a.level !== b.level ? 9999 : Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const near = points
            .map((p, j) => ({ j, d: cheb(a.tile, p.tile) }))
            .filter(x => x.j !== i && x.d < 9000)
            .sort((x, y) => x.d - y.d)
            .slice(0, kNearest);
        for (const n of near) {
            const b = points[n.j]!;
            add(
                `${segment}-nn-${i}-${n.j}`,
                a.tile,
                b.tile,
                `${a.label} → ${b.label} (nn)`,
                source,
                segment,
                gathering
            );
        }
    }
}

export function filterTravelRoutes(
    routes: TravelRoute[],
    segment: TravelSegment
): TravelRoute[] {
    if (segment === 'all') {
        return routes;
    }
    if (segment === 'gathering-all') {
        return routes.filter(r => r.gathering || r.segment === 'gathering-all');
    }
    return routes.filter(r => r.segment === segment);
}

export function travelRouteStats(routes: TravelRoute[]): Record<string, number> {
    const stats: Record<string, number> = { total: routes.length };
    for (const s of TRAVEL_SEGMENTS) {
        if (s === 'all') {
            continue;
        }
        stats[s] = filterTravelRoutes(routes, s).length;
    }
    return stats;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const segmentArg = args.find(a => a.startsWith('--segment='))?.split('=')[1] as TravelSegment | undefined;
    const segment: TravelSegment = segmentArg && TRAVEL_SEGMENTS.includes(segmentArg) ? segmentArg : 'all';
    const routes = filterTravelRoutes(buildTravelRoutes(), segment);
    const stats = travelRouteStats(buildTravelRoutes());

    if (args.includes('--list') || args.includes('--stats')) {
        console.log('Travel route segments:', JSON.stringify(stats, null, 2));
        console.log(`filter=${segment} → ${routes.length} legs`);
        if (args.includes('--list')) {
            for (const r of routes.slice(0, 40)) {
                console.log(`  ${r.id}: ${r.note} [${r.segment}]`);
            }
            if (routes.length > 40) {
                console.log(`  … +${routes.length - 40} more`);
            }
        }
    }

    if (args.includes('--write')) {
        const out = path.join(process.cwd(), 'tools/nav/script-travel.generated.json');
        fs.writeFileSync(
            out,
            JSON.stringify(
                {
                    description:
                        'Travel legs scraped from clues, gathering catalogs, cooking/firemaking, and quest areas. '
                        + 'Regenerate: bun --preload ./test/setup-dom.ts tools/nav/script-travel-corpus.ts --write. '
                        + 'Live: SEGMENT=… bun e2e/nav-script-travel-live.ts',
                    generatedAt: new Date().toISOString(),
                    stats,
                    routes
                },
                null,
                2
            )
        );
        console.log(`wrote ${out} (${routes.length} routes for segment=${segment})`);
    }
}
