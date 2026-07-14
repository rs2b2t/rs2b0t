// Generates src/bot/nav/data/stairEdges.json — cross-level transport edges
// from two sources:
//   (1) explicit switch_coord→p_telejump cases in the content pack's
//       ladders+stairs/scripts/stairs.rs2 (Climb-up/Climb-down on named
//       staircases; also a handful of dungeon↔surface hops), resolved to a
//       loc name + op label via the debugname on each [oplocN,<debugname>]
//       block.
//   (2) generic ladders (loc ids 1746-1750) that climb ±1 level in place —
//       ladders.rs2 handles these with movecoord(coord(), 0, ±1, 0), keyed by
//       the loc's op labels; we scan every packed mapsquare for their
//       instances and emit one in-place ±1 edge per Climb-up/Climb-down op.
//
// The runtime mechanic already works: handleTransport interacts the loc with
// `action` and waits for worldTile().level === to.level. This just bakes the
// graph edges so walkResilient's A* can route through them.
//
// Endpoint choice (snapAndReverse): the natural tiles — stairs.rs2 `from` = the
// case's loc_coord (the loc SW tile) and a generic ladder's own tile — are
// almost always NON-walkable in the baked pack (you stand beside a stair/ladder,
// not on it), so PathFinder.addEdges would drop them. So each endpoint is snapped
// to the nearest walkable tile (cardinal-first, radius 2); an in-place ladder hop
// is snapped to a tile walkable on BOTH levels (the tile you stand on to climb).
// We then add a reverse for every cross-level hop with the opposite op label — a
// staircase you climb up you can also climb down — so descent reuses the same
// connected tiles as ascent (some manors, e.g. Draynor, wall the up- and
// down-stair landings into separate L1 rooms). This mirrors how transports.json
// lists both directions. The nav-target coverage gate (tools/nav/coverage.ts,
// Task 2) over the 16 upstairs clue tiles is the acceptance test. Out of scope
// (angle-/literal-based, not baked here): wooden spiral / ship / cellar ladders.
//
// Usage: bun tools/nav/derive-stairs.ts [--engine <dir>] [--content <dir>] [--out <file>] [--check]

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';
import { parseSwitchStairs } from './stairsParse.js';

function argVal(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const engine = argVal('--engine') ?? process.env.ENGINE_DIR ?? path.join(homedir(), 'code', 'rs2b2t-engine');
const content = argVal('--content') ?? process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content');
const out = argVal('--out') ?? 'src/bot/nav/data/stairEdges.json';
const packPath = argVal('--pack') ?? 'out/collision.lcnav.gz';

// generic ladders: climb ±1 in place. 1746 laddertop(down) 1747 ladder(up)
// 1748 laddermiddle(up+down) 1749 laddertop_directional(down) 1750 ladder_directional(up)
const LADDER_LOC_IDS = new Set([1746, 1747, 1748, 1749, 1750]);

function edge(from: NavPoint, to: NavPoint, locName: string, action: string): TransportEdgeData {
    return { from, to, locName, action, kind: 'stair' };
}

// Chebyshev-ring offsets within radius R, cardinal-first (axis-aligned before
// diagonal at equal distance): the stand tile beside a stair/ladder is a cardinal
// neighbour, and preferring it avoids snapping into a walled-off diagonal closet.
function offsets(R: number): [number, number][] {
    const o: [number, number][] = [];
    for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
            o.push([dx, dz]);
        }
    }
    o.sort((a, b) => {
        const ca = Math.max(Math.abs(a[0]), Math.abs(a[1]));
        const cb = Math.max(Math.abs(b[0]), Math.abs(b[1]));
        if (ca !== cb) return ca - cb;
        const ma = Math.abs(a[0]) + Math.abs(a[1]);
        const mb = Math.abs(b[0]) + Math.abs(b[1]);
        if (ma !== mb) return ma - mb;
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0] - b[0];
    });
    return o;
}
const SNAP_OFFSETS = offsets(2);

// Opposite op label for the reverse hop: Climb-up<->Climb-down, Walk-up<->Walk-down.
function reverseAction(action: string): string {
    if (/-down/i.test(action)) return action.replace(/-down/i, '-up');
    if (/-up/i.test(action)) return action.replace(/-up/i, '-down');
    return action;
}

function snapWalkable(finder: PathFinder, x: number, z: number, level: number): NavPoint | null {
    for (const [dx, dz] of SNAP_OFFSETS) {
        if (finder.walkable(x + dx, z + dz, level)) return { x: x + dx, z: z + dz, level };
    }
    return null;
}

// Nearest tile beside (x,z) walkable on BOTH levels a and b — the tile you stand
// on to climb an in-place ladder (same x,z one level up/down).
function pivotBoth(finder: PathFinder, x: number, z: number, a: number, b: number): { x: number; z: number } | null {
    for (const [dx, dz] of SNAP_OFFSETS) {
        if (finder.walkable(x + dx, z + dz, a) && finder.walkable(x + dx, z + dz, b)) return { x: x + dx, z: z + dz };
    }
    return null;
}

// Snap every raw edge's endpoints to walkable tiles (else PathFinder.addEdges
// drops them), then add a reverse for each cross-level hop with the opposite op
// label. Dedupe by endpoints. See the file header for the rationale.
function snapAndReverse(finder: PathFinder, raw: TransportEdgeData[]): { edges: TransportEdgeData[]; dropped: number } {
    const snapped: TransportEdgeData[] = [];
    let dropped = 0;
    for (const e of raw) {
        let f: NavPoint | null;
        let t: NavPoint | null;
        if (e.from.x === e.to.x && e.from.z === e.to.z) {
            const piv = pivotBoth(finder, e.from.x, e.from.z, e.from.level, e.to.level);
            f = piv ? { x: piv.x, z: piv.z, level: e.from.level } : null;
            t = piv ? { x: piv.x, z: piv.z, level: e.to.level } : null;
        } else {
            f = snapWalkable(finder, e.from.x, e.from.z, e.from.level);
            t = snapWalkable(finder, e.to.x, e.to.z, e.to.level);
        }
        if (!f || !t) {
            dropped++;
            continue;
        }
        snapped.push({ ...e, from: f, to: t });
    }
    const seen = new Set<string>();
    const edges: TransportEdgeData[] = [];
    const key = (e: TransportEdgeData): string => `${e.from.x},${e.from.z},${e.from.level}>${e.to.x},${e.to.z},${e.to.level}`;
    const add = (e: TransportEdgeData): void => {
        const k = key(e);
        if (!seen.has(k)) {
            seen.add(k);
            edges.push(e);
        }
    };
    for (const e of snapped) {
        add(e);
    }
    for (const e of snapped) {
        if (e.from.level !== e.to.level && /-(up|down)/i.test(e.action)) {
            add({ from: e.to, to: e.from, locName: e.locName, action: reverseAction(e.action), kind: e.kind });
        }
    }
    return { edges, dropped };
}

function main(): void {
    const { configs } = loadLocTypes(engine);
    const edges: TransportEdgeData[] = [];

    // (1) stairs.rs2 explicit cases → resolve debugname → locName + op label
    const byDebug = new Map<string, (typeof configs)[number]>();
    for (const c of configs) {
        if (c.debugname) {
            byDebug.set(c.debugname, c);
        }
    }
    const stairsText = fs.readFileSync(path.join(content, 'scripts/ladders+stairs/scripts/stairs.rs2'), 'utf8');
    let stairsCases = 0;
    let stairsSkipped = 0;
    for (const s of parseSwitchStairs(stairsText)) {
        const def = byDebug.get(s.debugname);
        const action = def?.op?.[s.op - 1];
        if (!def || !action) {
            stairsSkipped++;
            continue;
        }
        edges.push(edge(s.from, s.to, def.name ?? s.debugname, action));
        stairsCases++;
    }

    // (2) generic ladders from the map loc data → ±1-in-place edges
    let ladderEdges = 0;
    for (const { mx, mz, land, loc } of loadMapsquares(engine)) {
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));
        forEachLoc(new Reader(loc), inst => {
            if (!LADDER_LOC_IDS.has(inst.locId)) {
                return;
            }
            const def = configs[inst.locId];
            if (!def?.op) {
                return;
            }
            const level = bridgedLevel(lands, inst.coord, inst.x, inst.z, inst.level);
            if (level < 0) {
                return;
            }
            const here: NavPoint = { x: baseX + inst.x, z: baseZ + inst.z, level };
            for (const op of def.op) {
                if (!op) {
                    continue;
                }
                if (/climb-up/i.test(op)) {
                    edges.push(edge(here, { ...here, level: level + 1 }, def.name ?? 'Ladder', op));
                    ladderEdges++;
                } else if (/climb-down/i.test(op) && level > 0) {
                    edges.push(edge(here, { ...here, level: level - 1 }, def.name ?? 'Ladder', op));
                    ladderEdges++;
                }
            }
        });
    }

    // snap endpoints to walkable tiles + add reverse hops (needs the baked pack)
    let packBytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (packBytes[0] === 0x1f && packBytes[1] === 0x8b) {
        packBytes = gunzipSync(packBytes);
    }
    const finder = new PathFinder(packBytes);
    const rawCount = edges.length;
    const { edges: finalEdges, dropped } = snapAndReverse(finder, edges);

    finalEdges.sort((a, b) => a.from.level - b.from.level || a.from.x - b.from.x || a.from.z - b.from.z || a.to.level - b.to.level || a.to.x - b.to.x || a.to.z - b.to.z);

    // one edge per line: greppable, hand-editable, diff-stable
    const json = '[\n' + finalEdges.map(e => '    ' + JSON.stringify(e)).join(',\n') + '\n]\n';

    const stats = `${finalEdges.length} edges (${rawCount} raw = ${stairsCases} stairs.rs2 + ${ladderEdges} generic-ladder, ${stairsSkipped} unresolved; ${dropped} unsnappable dropped; snapped + reversed)`;
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        if (current !== json) {
            console.error(`STALE: ${out} — run bun tools/nav/derive-stairs.ts`);
            process.exitCode = 1;
        } else {
            console.log(`ok: ${out} matches — ${stats}`);
        }
    } else {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, json);
        console.log(`wrote ${out}: ${stats}`);
    }

    // sanity gate: a cross-level edge with BOTH endpoints walkable must survive
    // near each known staircase/ladder (proves the snap kept it — addEdges would
    // otherwise drop a non-walkable endpoint and its upstairs clue tile FAILs).
    const cheb = (p: NavPoint, x: number, z: number): number => Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
    const expect: { name: string; fl: number; tl: number; x: number; z: number }[] = [
        { name: 'Lumbridge Castle South (stairs.rs2)', fl: 0, tl: 1, x: 3205, z: 3209 },
        { name: 'Varrock East bank (stairs.rs2)', fl: 0, tl: 1, x: 3255, z: 3420 },
        { name: 'Lumbridge tower ladder (1747)', fl: 0, tl: 1, x: 3229, z: 3213 },
        { name: 'Catherby ladder (1747)', fl: 0, tl: 1, x: 2807, z: 3454 }
    ];
    let failures = 0;
    for (const e of expect) {
        const hit = finalEdges.some(x => x.from.level === e.fl && x.to.level === e.tl && cheb(x.from, e.x, e.z) <= 3 && cheb(x.to, e.x, e.z) <= 3 && finder.walkable(x.from.x, x.from.z, x.from.level) && finder.walkable(x.to.x, x.to.z, x.to.level));
        console.log(`${hit ? 'PASS' : 'FAIL'} ${e.name} — walkable ${e.fl}->${e.tl} edge near ${e.x},${e.z}`);
        if (!hit) {
            failures++;
        }
    }
    if (failures > 0) {
        process.exitCode = 1;
    }
}

main();
