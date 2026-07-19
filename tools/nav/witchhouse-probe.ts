// Offline probe: is the Witch's House cellar ladder (2907,3476,0) reachable through
// the INTERIOR (front door -> inner doors), or is it genuinely sealed? Re-examines the
// live "DirectNav couldn't advance" verdict — the bot may have been probing the ladder
// through the NORTH EXTERIOR wall after failing the inner door at (2902,3474).
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);

console.log('--- door edges in the house bbox (x2896-2910, z3462-3480, L0) ---');
for (const d of doorsJson as DoorEdgeData[]) {
    if (d.level === 0 && d.x >= 2896 && d.x <= 2910 && d.z >= 3462 && d.z <= 3480) console.log(`  Door edge @ (${d.x},${d.z}) dir=${d.dir}`);
}

const W = (x: number, z: number) => finder.walkable(x, z, 0);
console.log('--- walkability (L0) ---');
for (const [x, z, label] of [
    [2900, 3474, 'outside front door (potted plant)'],
    [2902, 3473, 'inside front door'],
    [2903, 3474, 'interior W room'],
    [2905, 3475, 'interior mid'],
    [2906, 3476, 'ladder W-adjacent'],
    [2907, 3475, 'ladder S-adjacent'],
    [2907, 3477, 'ladder N-adjacent'],
    [2907, 3476, 'ladder tile itself'],
    [2908, 3478, 'live wedge tile (NE of ladder)'],
] as [number, number, string][]) console.log(`  ${W(x, z) ? 'WALK' : 'BLOK'} (${x},${z}) ${label}`);

type P = { x: number; z: number; level: number };
const trace = (from: P, to: P, label: string) => {
    const o = finder.findPath(from, to);
    if (o.ok) {
        console.log(`  OK  ${label}: cost ${o.cost.toFixed(0)}, ${o.waypoints.length} wp`);
        console.log(`      ${o.waypoints.map(w => `(${w.x},${w.z})${w.transport ? '[' + w.transport.action + ' ' + w.transport.locX + ',' + w.transport.locZ + ']' : ''}`).join(' -> ')}`);
    } else console.log(`  NO  ${label}: ${o.reason}`);
};
console.log('--- paths ---');
trace({ x: 2900, z: 3474, level: 0 }, { x: 2906, z: 3476, level: 0 }, 'outside front door -> ladder W-adjacent');
trace({ x: 2900, z: 3474, level: 0 }, { x: 2907, z: 3477, level: 0 }, 'outside front door -> ladder N-adjacent');
trace({ x: 2902, z: 3473, level: 0 }, { x: 2906, z: 3476, level: 0 }, 'inside front door -> ladder W-adjacent');
trace({ x: 2900, z: 3474, level: 0 }, { x: 2908, z: 3478, level: 0 }, 'outside front door -> live wedge tile (2908,3478)');
