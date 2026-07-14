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
// Endpoint choice: edges are emitted at their natural tiles — stairs.rs2 `from`
// is the case's loc_coord (the loc SW tile, MAY be non-walkable); generic
// ladder `from` is the ladder loc's (bridged) tile. PathFinder.addEdges drops
// any edge whose from/to isn't walkable in the baked pack, and the nav-target
// coverage gate (tools/nav/coverage.ts, Task 2) over the upstairs clue tiles is
// the corrective loop for specific misses (e.g. wooden spiral / ship / cellar
// ladders, which are angle- or literal-based and intentionally not baked here).
//
// Usage: bun tools/nav/derive-stairs.ts [--engine <dir>] [--content <dir>] [--out <file>] [--check]

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import type { NavPoint, TransportEdgeData } from '#/bot/nav/PathFinder.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';
import { parseSwitchStairs } from './stairsParse.js';

function argVal(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const engine = argVal('--engine') ?? process.env.ENGINE_DIR ?? path.join(homedir(), 'code', 'rs2b2t-engine');
const content = argVal('--content') ?? process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content');
const out = argVal('--out') ?? 'src/bot/nav/data/stairEdges.json';

// generic ladders: climb ±1 in place. 1746 laddertop(down) 1747 ladder(up)
// 1748 laddermiddle(up+down) 1749 laddertop_directional(down) 1750 ladder_directional(up)
const LADDER_LOC_IDS = new Set([1746, 1747, 1748, 1749, 1750]);

function edge(from: NavPoint, to: NavPoint, locName: string, action: string): TransportEdgeData {
    return { from, to, locName, action, kind: 'stair' };
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

    edges.sort((a, b) => a.from.level - b.from.level || a.from.x - b.from.x || a.from.z - b.from.z || a.to.level - b.to.level);

    // one edge per line: greppable, hand-editable, diff-stable
    const json = '[\n' + edges.map(e => '    ' + JSON.stringify(e)).join(',\n') + '\n]\n';

    if (process.argv.includes('--check')) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        if (current !== json) {
            console.error(`STALE: ${out} — run bun tools/nav/derive-stairs.ts`);
            process.exitCode = 1;
        }
    } else {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, json);
    }
    console.log(`wrote ${out}: ${edges.length} edges (${stairsCases} stairs.rs2 cases, ${stairsSkipped} unresolved, ${ladderEdges} generic-ladder)`);

    // sanity gate (mirror derive-doors' expect list): known up-hops must exist
    const expect: [number, number, number, number, number, number][] = [
        [3204, 3207, 0, 3205, 3209, 1], // Lumbridge Castle South (stairs.rs2 spiralstairs: 0_50_50_4_7 → 1_50_50_5_9)
        [3255, 3421, 0, 3255, 3420, 1], // Varrock East bank (stairs.rs2 spiralstairs)
        [3229, 3213, 0, 3229, 3213, 1], // Lumbridge tower ladder (generic 1747)
        [2807, 3454, 0, 2807, 3454, 1] // Catherby ladder (generic 1747)
    ];
    let failures = 0;
    for (const [fx, fz, fl, tx, tz, tl] of expect) {
        const hit = edges.some(e => e.from.x === fx && e.from.z === fz && e.from.level === fl && e.to.x === tx && e.to.z === tz && e.to.level === tl);
        console.log(`${hit ? 'PASS' : 'FAIL'} ${fx},${fz},${fl} -> ${tx},${tz},${tl}`);
        if (!hit) {
            failures++;
        }
    }
    if (failures > 0) {
        process.exitCode = 1;
    }
}

main();
