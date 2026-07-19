// One-shot Wizards' Tower diagnostic: are the door + stair edges surviving pack
// compilation, and is there a full outside -> Traiborn (L1) path?
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
console.log(`pack: ${finder.mapsquares} msq, ${finder.doorEdges} door edges, ${finder.transportEdges} transport edges`);

const W = (x: number, z: number, l: number) => finder.walkable(x, z, l);
const tiles: [number, number, number, string][] = [
    [3109, 3168, 0, 'door approach (outside)'],
    [3109, 3167, 0, 'door outside tile'],
    [3109, 3166, 0, 'door inside tile'],
    [3111, 3163, 0, 'door2 inside'],
    [3111, 3162, 0, 'door2 outside'],
    [3108, 3165, 0, 'interior SE'],
    [3105, 3162, 0, 'interior mid'],
    [3103, 3160, 0, 'interior near stair'],
    [3102, 3159, 0, 'stair stand A (L0)'],
    [3105, 3160, 0, 'stair stand B (L0)'],
    [3105, 3160, 1, 'stair top A (L1)'],
    [3103, 3158, 1, 'stair top B (L1)'],
    [3112, 3162, 1, 'Traiborn (L1)'],
];
console.log('--- walkability ---');
for (const [x, z, l, label] of tiles) console.log(`  ${W(x, z, l) ? 'WALK' : 'BLOK'} (${x},${z},${l}) ${label}`);

type NavPoint = { x: number; z: number; level: number };
const runs: [NavPoint, NavPoint, string][] = [
    [{ x: 3109, z: 3168, level: 0 }, { x: 3112, z: 3162, level: 1 }, 'approach -> Traiborn (L1, full climb)'],
    [{ x: 3109, z: 3168, level: 0 }, { x: 3105, z: 3160, level: 0 }, 'approach -> stair stand B INSIDE (L0)'],
    [{ x: 3109, z: 3168, level: 0 }, { x: 3104, z: 3159, level: 0 }, 'approach -> tile E of staircase INSIDE (L0)'],
];
console.log('--- paths (with full waypoint trace) ---');
for (const [from, to, label] of runs) {
    const o = finder.findPath(from, to);
    if (o.ok) {
        const climbs = o.waypoints.filter(w => w.transport && w.transport.toLevel !== undefined).length;
        console.log(`  OK  ${label}: cost ${o.cost.toFixed(0)}, ${o.waypoints.length} wp, ${climbs} climbs`);
        console.log(`      ${o.waypoints.map(w => `(${w.x},${w.z},${w.level})${w.transport ? '[' + w.transport.action + ']' : ''}`).join(' -> ')}`);
    } else {
        console.log(`  NO  ${label}: ${o.reason} (expanded ${o.expanded})`);
    }
}
