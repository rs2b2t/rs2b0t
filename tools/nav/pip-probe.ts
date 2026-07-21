// One-shot offline probe for Priest in Peril route coverage: can today's baked
// pack + door/transport/stair edges path every leg the quest needs?
// Usage: bun tools/nav/pip-probe.ts [--pack out/collision.lcnav.gz]

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

const legs: { name: string; from: { x: number; z: number; level: number }; to: { x: number; z: number; level: number } }[] = [
    { name: 'Varrock palace (Roald) -> temple door exterior', from: { x: 3222, z: 3476, level: 0 }, to: { x: 3406, z: 3488, level: 0 } },
    { name: 'temple door exterior -> north trapdoor (mausoleum)', from: { x: 3406, z: 3488, level: 0 }, to: { x: 3405, z: 3506, level: 0 } },
    { name: 'temple interior L0 -> cell door L2', from: { x: 3410, z: 3488, level: 0 }, to: { x: 3414, z: 3489, level: 2 } },
    { name: 'crypt landing -> dog', from: { x: 3405, z: 9907, level: 0 }, to: { x: 3405, z: 9902, level: 0 } },
    { name: 'crypt landing -> monuments room (thru Gate door1)', from: { x: 3405, z: 9907, level: 0 }, to: { x: 3423, z: 9890, level: 0 } },
    { name: 'monuments room -> Drezel (thru Gate door2)', from: { x: 3423, z: 9890, level: 0 }, to: { x: 3440, z: 9894, level: 0 } },
    { name: 'temple INTERIOR -> east trapdoor', from: { x: 3414, z: 3487, level: 0 }, to: { x: 3422, z: 3485, level: 0 } },
    { name: 'temple exterior -> temple interior (front door)', from: { x: 3406, z: 3488, level: 0 }, to: { x: 3414, z: 3487, level: 0 } },
    { name: 'Varrock East bank -> temple door exterior', from: { x: 3253, z: 3420, level: 0 }, to: { x: 3406, z: 3488, level: 0 } },
    // Informational: OK means the baked graph carries a crypt exit edge; FAIL is
    // fine — essenceLeg walks to the surface via its hops BEFORE any withdraw step.
    { name: 'crypt landing -> Varrock East bank (essence-run exit, graph-only)', from: { x: 3405, z: 9907, level: 0 }, to: { x: 3253, z: 3420, level: 0 } }
];

for (const leg of legs) {
    const outcome = finder.findPath(leg.from, leg.to);
    if (outcome.ok) {
        const doors = outcome.waypoints.filter(w => w.transport && w.transport.toLevel === undefined).length;
        console.log(`OK   ${leg.name}: cost ${outcome.cost}, ${outcome.waypoints.length} waypoints, ${doors} doors`);
    } else {
        console.log(`FAIL ${leg.name}: ${outcome.reason} (expanded ${outcome.expanded})`);
    }
}
