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

    const openable = new Set<number>();
    let lockedSkipped = 0;
    for (let id = 0; id < configs.length; id++) {
        const type = configs[id];
        if (!type.op || !type.op.some(op => op?.toLowerCase() === 'open')) {
            continue;
        }
        const QUEST_LOCKED = new Set(['closet_door', '1to2', '2to3', '4to5', '5to6', '8to9', '2to5', '3to6', '4to7', '5to8']);
        const label = `${type.name ?? ''} ${type.debugname ?? ''}`.toLowerCase();
        if (label.includes('locked') || (type.debugname ?? '').startsWith('macro_') || QUEST_LOCKED.has(type.debugname ?? '')) {
            lockedSkipped++;
            continue;
        }
        openable.add(id);
    }

    const ONE_WAY_EXCLUDED = new Set(['3108,3353,0', '3109,3353,0']);

    const edges: DoorEdge[] = [];
    const skippedShapes = new Map<string, number>();
    const nameCounts = new Map<string, number>();
    let mapsquares = 0;
    let oneWaySkipped = 0;

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

            if (ONE_WAY_EXCLUDED.has(`${baseX + instance.x},${baseZ + instance.z},${level}`)) {
                oneWaySkipped++;
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

    const json = '[\n' + edges.map(edge => '    ' + JSON.stringify(edge)).join(',\n') + '\n]\n';
    fs.mkdirSync(path.dirname(opts.out), { recursive: true });
    fs.writeFileSync(opts.out, json);

    console.log(`openable wall loc types: ${openable.size} (skipped ${lockedSkipped} locked/macro types, ${oneWaySkipped} one-way instances -> curated transports)`);
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
