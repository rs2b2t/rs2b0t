// Offline A* check + timing bench over the baked pack (Slice 5b). Runs the
// exact PathFinder module the NavWorker ships, under Bun.
//
// Usage: bun tools/nav/bench-path.ts [--pack out/collision.lcnav.gz] [--runs 20]

import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type Waypoint } from '#/bot/nav/PathFinder.js';

const args = process.argv.slice(2);
let packPath = 'out/collision.lcnav.gz';
let runs = 20;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pack') {
        packPath = args[++i];
    } else if (args[i] === '--runs') {
        runs = Number(args[++i]);
    }
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}

const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson);
console.log(`pack: ${finder.mapsquares} mapsquares, ${finder.doorEdges} door edges, ${finder.transportEdges} transport edges (members=${finder.members})`);

const describe = (wp: Waypoint): string => (wp.transport ? `(${wp.x},${wp.z},${wp.level})[${wp.transport.action} ${wp.transport.locName}@${wp.transport.locX},${wp.transport.locZ}${wp.transport.toLevel !== undefined ? `->L${wp.transport.toLevel}` : ''}]` : `(${wp.x},${wp.z},${wp.level})`);

const routes: { name: string; from: NavPoint; to: NavPoint }[] = [
    { name: 'Lumbridge -> Varrock square', from: { x: 3222, z: 3218, level: 0 }, to: { x: 3213, z: 3428, level: 0 } },
    { name: 'Lumbridge -> chicken pen interior', from: { x: 3222, z: 3218, level: 0 }, to: { x: 3232, z: 3298, level: 0 } },
    { name: 'chicken pen -> Varrock square', from: { x: 3232, z: 3298, level: 0 }, to: { x: 3213, z: 3428, level: 0 } },
    { name: 'NavDemo start (3222,3210) -> pen', from: { x: 3222, z: 3210, level: 0 }, to: { x: 3232, z: 3298, level: 0 } },
    { name: 'Lumbridge ground -> castle roof L2 (stairs)', from: { x: 3222, z: 3218, level: 0 }, to: { x: 3209, z: 3213, level: 2 } },
    { name: 'Lumbridge -> Falador square', from: { x: 3222, z: 3218, level: 0 }, to: { x: 2964, z: 3378, level: 0 } },
    { name: 'Lumbridge -> Al Kharid (toll gate)', from: { x: 3222, z: 3218, level: 0 }, to: { x: 3293, z: 3174, level: 0 } }
];

for (const route of routes) {
    const samples: number[] = [];
    let outcome = finder.findPath(route.from, route.to);
    for (let i = 0; i < runs; i++) {
        const started = performance.now();
        outcome = finder.findPath(route.from, route.to);
        samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length / 2)];
    const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];

    if (!outcome.ok) {
        console.log(`FAIL  ${route.name}: ${outcome.reason} (expanded ${outcome.expanded}, p50 ${p50.toFixed(1)}ms)`);
        process.exitCode = 1;
        continue;
    }

    const transports = outcome.waypoints.filter(wp => wp.transport);
    console.log(`ok    ${route.name}: cost ${outcome.cost}, ${outcome.waypoints.length} waypoints (${transports.length} transports), expanded ${outcome.expanded}, p50 ${p50.toFixed(1)}ms p95 ${p95.toFixed(1)}ms`);
    for (const wp of transports) {
        console.log(`        via ${describe(wp)}`);
    }
}
