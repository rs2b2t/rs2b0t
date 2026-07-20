// Offline reachability probe for the clue tool-acquisition tiles: the four NPC
// anchors + two spade spawns, each from a spread of bank/clue starts. Runs the
// exact PathFinder NavWorker ships. Usage: bun tools/nav/clue-tool-tiles-probe.ts
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';
import { KOJO, MURPHY, PROFESSOR, SPADE_SPAWNS } from '#/bot/clues/data/toolAcquire.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);
console.log(`pack: ${finder.mapsquares} mapsquares, ${finder.doorEdges} door edges, ${finder.transportEdges} transport edges (members=${finder.members})`);

const STARTS = [
    { name: 'Ardougne market', x: 2662, z: 3305, level: 0 },
    { name: 'Falador east bank', x: 3013, z: 3356, level: 0 },
    { name: 'Catherby bank', x: 2809, z: 3440, level: 0 }
];
const tp = (name: string, t: { x: number; z: number; level: number }) => ({ name, x: t.x, z: t.z, level: t.level });
const TARGETS = [
    tp('professor', PROFESSOR.anchor),
    tp('Murphy', MURPHY.anchor),
    tp('Kojo', KOJO.anchor),
    tp('spade Ardougne', SPADE_SPAWNS[0]),
    tp('spade Falador', SPADE_SPAWNS[1])
];

let bad = 0;
for (const s of STARTS) {
    for (const t of TARGETS) {
        const o = finder.findPath({ x: s.x, z: s.z, level: s.level }, { x: t.x, z: t.z, level: t.level });
        const line = o.ok ? `ok cost ${o.cost}` : `NO PATH (${o.reason}, expanded ${o.expanded})`;
        if (!o.ok) {
            bad++;
        }
        console.log(`${s.name} -> ${t.name}: ${line}`);
    }
}
console.log(bad === 0 ? 'ALL REACHABLE' : `${bad} unreachable pair(s)`);
process.exit(bad === 0 ? 0 : 1);
