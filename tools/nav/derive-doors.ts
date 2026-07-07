// Auto-derive door/gate transport edges for the web-walker (Slice 5b).
//
// Scans every packed mapsquare for WALL-layer loc instances whose LocType has
// an 'Open' op (doors, gates, large doors) and emits one edge per instance
// into src/bot/nav/data/doors.json. The two tiles an edge connects follow
// from how rsmod's CollisionEngine.changeWallStraight applies wall flags
// (src/bot/nav/rsmod/CollisionEngine.ts):
//
//   angle 0 (WEST)  -> WALL_WEST  on (x,z), WALL_EAST  on (x-1,z): door joins (x,z)<->(x-1,z)
//   angle 1 (NORTH) -> WALL_NORTH on (x,z), WALL_SOUTH on (x,z+1): door joins (x,z)<->(x,z+1)
//   angle 2 (EAST)  -> WALL_EAST  on (x,z), WALL_WEST  on (x+1,z): door joins (x,z)<->(x+1,z)
//   angle 3 (SOUTH) -> WALL_SOUTH on (x,z), WALL_NORTH on (x,z-1): door joins (x,z)<->(x,z-1)
//
// Sanity-checked against known instances (validated with probe-locs.ts +
// build-collision verify): the east-Lumbridge chicken-pen gate halves at
// (3236,3295..3296) angle 2 connect across the fence line the collision bake
// blocks at x=3236/3237, and the Lumbridge castle ground-floor door sits at
// (3208,3211) angle 1.
//
// Non-straight wall shapes (diagonal/square corner, L) with an Open op are
// counted and skipped — a corner wall joins tiles diagonally and the runtime
// walker only consumes N/E/S/W door edges.
//
// Usage: bun tools/nav/derive-doors.ts [--engine <dir>] [--out <file>]

import fs from 'node:fs';
import path from 'node:path';

import { LocLayer, LocShape, locShapeLayer } from '#/bot/nav/rsmod/flags.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';

interface DoorEdge {
    x: number;
    z: number;
    level: number;
    locId: number;
    locName: string;
    dir: 'N' | 'E' | 'S' | 'W';
}

// LocAngle.WEST/NORTH/EAST/SOUTH (0..3) -> the wall edge of the loc's tile
const ANGLE_DIR: ('W' | 'N' | 'E' | 'S')[] = ['W', 'N', 'E', 'S'];

function parseArgs(): { engine: string; out: string } {
    const args = process.argv.slice(2);
    let engine = '/Users/elliotninjaone/code/lostcity-dev/engine';
    let out = 'src/bot/nav/data/doors.json';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--engine') {
            engine = args[++i];
        } else if (args[i] === '--out') {
            out = args[++i];
        } else {
            console.error(`unknown argument: ${args[i]}`);
            process.exit(2);
        }
    }
    return { engine, out };
}

function main(): void {
    const opts = parseArgs();
    const { configs } = loadLocTypes(opts.engine);

    // loc ids whose type is openable: any op slot is exactly 'Open'
    const openable = new Set<number>();
    let lockedSkipped = 0;
    for (let id = 0; id < configs.length; id++) {
        const type = configs[id];
        if (!type.op || !type.op.some(op => op?.toLowerCase() === 'open')) {
            continue;
        }
        // skip content a walker can never legitimately use: names that say
        // 'locked', and random-event instance locs (macro_* — e.g. the 1373
        // 'Open'-able macro_maze_wallhigh maze walls)
        const label = `${type.name ?? ''} ${type.debugname ?? ''}`.toLowerCase();
        if (label.includes('locked') || (type.debugname ?? '').startsWith('macro_')) {
            lockedSkipped++;
            continue;
        }
        openable.add(id);
    }

    const edges: DoorEdge[] = [];
    const skippedShapes = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    let mapsquares = 0;

    for (const { mx, mz, land, loc } of loadMapsquares(opts.engine)) {
        mapsquares++;
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));

        forEachLoc(new Reader(loc), instance => {
            if (!openable.has(instance.locId) || locShapeLayer(instance.shape) !== LocLayer.WALL) {
                return;
            }

            const type = configs[instance.locId];
            const level = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
            if (level < 0) {
                return;
            }

            if (instance.shape !== LocShape.WALL_STRAIGHT) {
                const shapeName = Object.entries(LocShape).find(([, value]) => value === instance.shape)?.[0] ?? `${instance.shape}`;
                skippedShapes.set(shapeName, (skippedShapes.get(shapeName) ?? 0) + 1);
                return;
            }

            const locName = type.name ?? type.debugname ?? `loc_${instance.locId}`;
            edges.push({
                x: baseX + instance.x,
                z: baseZ + instance.z,
                level,
                locId: instance.locId,
                locName,
                dir: ANGLE_DIR[instance.angle]
            });
            nameCounts.set(locName, (nameCounts.get(locName) ?? 0) + 1);
        });
    }

    edges.sort((a, b) => a.level - b.level || a.x - b.x || a.z - b.z || a.locId - b.locId);

    // one edge per line: greppable and hand-editable, diff-stable
    const json = '[\n' + edges.map(edge => '    ' + JSON.stringify(edge)).join(',\n') + '\n]\n';
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, json);

    console.log(`openable wall loc types: ${openable.size} (skipped ${lockedSkipped} locked/macro types)`);
    console.log(`mapsquares scanned: ${mapsquares}`);
    console.log(`door edges derived: ${edges.length} -> ${opts.out}`);
    console.log('by name:');
    for (const [name, count] of [...nameCounts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count}\t${name}`);
    }
    if (skippedShapes.size > 0) {
        console.log('skipped non-straight wall shapes with Open op:');
        for (const [shape, count] of skippedShapes) {
            console.log(`  ${count}\t${shape}`);
        }
    }

    // sanity: the chicken-pen gate halves and the Lumbridge castle door must
    // have been derived with the expected directions
    const expect: [number, number, string][] = [
        [3236, 3296, 'E'],
        [3236, 3295, 'E'],
        [3208, 3211, 'N']
    ];
    for (const [x, z, dir] of expect) {
        const hit = edges.find(edge => edge.x === x && edge.z === z && edge.level === 0);
        const ok = hit && hit.dir === dir;
        console.log(`${ok ? 'PASS' : 'FAIL'}  expected ${dir}-edge at (${x},${z},0): ${hit ? `${hit.locName} dir=${hit.dir}` : 'missing'}`);
        if (!ok) {
            process.exitCode = 1;
        }
    }
}

main();
