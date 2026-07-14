// One-shot offline path probe (Task 13): can the Lumbridge -> Rellekka
// rock-crab route be found with today's baked pack + door/transport edges?
// Runs the exact PathFinder module NavWorker ships, under Bun — no browser.
// Pack-loading cribbed from tools/nav/bench-path.ts.
//
// Usage: bun tools/nav/route-probe.ts [--pack out/collision.lcnav.gz]

import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';

const args = process.argv.slice(2);
let packPath = 'out/collision.lcnav.gz';
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pack') {
        packPath = args[++i];
    }
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}

const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);
console.log(`pack: ${finder.mapsquares} mapsquares, ${finder.doorEdges} door edges, ${finder.transportEdges} transport edges (members=${finder.members})`);

// bun tools/nav/route-probe.ts — is the Lumbridge → Rellekka crab route
// pathable with today's doors/transports?
const from = { x: 3222, z: 3218, level: 0 }; // Lumbridge spawn
const to = { x: 2710, z: 3720, level: 0 }; // RockCrab DEFAULT_FIELD
const outcome = finder.findPath(from, to);
if (!outcome.ok) {
    console.error(`NO PATH: ${outcome.reason} (expanded ${outcome.expanded})`);
    process.exit(1);
}
const doors = outcome.waypoints.filter(w => w.transport && w.transport.toLevel === undefined).length;
console.log(`ok: cost ${outcome.cost}, ${outcome.waypoints.length} waypoints, ${doors} door crossings`);
