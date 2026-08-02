/**
 * Flood-fill connectivity components under the collision pack + active edges.
 *
 *   bun tools/nav/component-report.ts --seed 3019,9849,0 --seed 3019,9739,0
 *   bun tools/nav/component-report.ts --seeds-file tools/nav/mainland-routes.json
 */
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '#/bot/nav/PathFinder.js';

function parseTile(s: string): NavPoint {
    const [x, z, level] = s.split(',').map(Number);
    return { x: x!, z: z!, level: level! };
}

const args = process.argv.slice(2);
let packPath = 'out/collision.lcnav.gz';
const seeds: NavPoint[] = [];
let maxExp = 500_000;

for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--pack') {
        packPath = args[++i]!;
    } else if (a === '--seed') {
        seeds.push(parseTile(args[++i]!));
    } else if (a === '--max') {
        maxExp = Number(args[++i]);
    }
}

if (seeds.length === 0) {
    seeds.push(
        { x: 3019, z: 9849, level: 0 }, // party under
        { x: 3019, z: 9739, level: 0 }, // guild under
        { x: 3222, z: 3218, level: 0 }, // lumbridge
        { x: 2965, z: 3378, level: 0 }, // falador
        { x: 3093, z: 3493, level: 0 } // edgeville
    );
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson as never);

console.log(`seeds: ${seeds.length}, maxExpansions ${maxExp}`);
console.log('pairwise pathability (ok cost / FAIL):');
console.log('from\\to'.padEnd(22) + seeds.map(s => `${s.x},${s.z}`.padStart(14)).join(''));

for (const a of seeds) {
    let row = `${a.x},${a.z},L${a.level}`.padEnd(22);
    for (const b of seeds) {
        if (a === b) {
            row += '—'.padStart(14);
            continue;
        }
        const r = finder.findPath(a, b, undefined, maxExp);
        row += (r.ok ? `ok ${r.cost}` : 'FAIL').padStart(14);
    }
    console.log(row);
}
