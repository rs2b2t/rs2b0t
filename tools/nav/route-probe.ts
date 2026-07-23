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

const from = { x: 3222, z: 3218, level: 0 };
const to = { x: 2710, z: 3720, level: 0 };
const outcome = finder.findPath(from, to);
if (!outcome.ok) {
    console.error(`NO PATH: ${outcome.reason} (expanded ${outcome.expanded})`);
    process.exit(1);
}
const doors = outcome.waypoints.filter(w => w.transport && w.transport.toLevel === undefined).length;
console.log(`ok: cost ${outcome.cost}, ${outcome.waypoints.length} waypoints, ${doors} door crossings`);
