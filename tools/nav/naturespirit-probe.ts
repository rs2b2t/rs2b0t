/** Pathfind to every tile the Nature Spirit module names, from the banks it starts each leg at.
 *  Why: a stand tile next to an unwalkable loc is not automatically reachable, and a swamp the walker cannot enter is a nav-data problem rather than a quest one. */

//   bun tools/nav/build-collision.ts --engine ~/code/rs2b2t-engine
//   bun tools/nav/naturespirit-probe.ts
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '../../src/bot/event/webwalk/data/doors.json';
import stairsJson from '../../src/bot/event/webwalk/data/stairEdges.json';
import transportsJson from '../../src/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/event/webwalk/PathFinder.js';
import { NS_TILE } from '../../src/bot/api/ai/quests/defs/druidspirit/areas.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson);

const point = (t: { x: number; z: number; level: number }): NavPoint => ({ x: t.x, z: t.z, level: t.level });

const FROM: [string, NavPoint][] = [
    ['Varrock east bank', point(NS_TILE.VARROCK_EAST_BANK)],
    ['Al Kharid bank', point(NS_TILE.ALKHARID_BANK)]
];

const TO: [string, NavPoint][] = [
    ['Drezel (mausoleum)', point(NS_TILE.DREZEL)],
    ['swamp gate, north side', point(NS_TILE.GATE)],
    ['camp', point(NS_TILE.CAMP)],
    ['spirit', point(NS_TILE.SPIRIT)],
    ['nature stone', point(NS_TILE.NATURE_STONE)],
    ['faith stone', point(NS_TILE.FAITH_STONE)],
    ['spirit stone', point(NS_TILE.SPIRIT_STONE)],
    ['washing bowl', point(NS_TILE.BOWL)],
    ['grotto tree', point(NS_TILE.GROTTO_TREE)],
    ['grotto door', point(NS_TILE.GROTTO_DOOR)],
    ['ghast hunt tile', point(NS_TILE.GHAST_HUNT)],
    ['Dommik', point(NS_TILE.DOMMIK)],
    ['Al Kharid furnace', point(NS_TILE.FURNACE)],
    ['silver rocks', point(NS_TILE.SILVER_ROCKS)],
    ['Father Urhney', point(NS_TILE.URHNEY)]
];

let unreachable = 0;
for (const [fromName, from] of FROM) {
    console.log(`from ${fromName} (${from.x},${from.z},${from.level}):`);
    for (const [name, to] of TO) {
        const out = finder.findPath(from, to, undefined, 2_000_000);
        if (!out.ok) {
            unreachable++;
            console.log(`  UNREACHABLE  ${name.padEnd(22)} (${to.x},${to.z},${to.level}) — ${out.reason}`);
            continue;
        }
        const last = out.waypoints[out.waypoints.length - 1];
        // Why: findPath snapping to within five tiles is a weaker claim than walkResilient(radius 2) arriving.
        const snapped = Math.max(Math.abs(last.x - to.x), Math.abs(last.z - to.z));
        const verdict = snapped > 2 ? 'SNAPPED' : 'ok     ';
        if (snapped > 2) {
            unreachable++;
        }
        console.log(`  ${verdict} ${name.padEnd(22)} (${to.x},${to.z},${to.level}) ${out.waypoints.length} waypoints, cost ${out.cost}, snapped ${snapped}`);
    }
}

// Why: the grotto is entered by a scripted teleport, so no route into it exists and none should.
console.log(`\ngrotto interior (${NS_TILE.GROTTO_INSIDE.x},${NS_TILE.GROTTO_INSIDE.z}) is a sealed pocket — entered by the loc, never walked to`);

if (unreachable > 0) {
    console.error(`${unreachable} tile(s) unreachable`);
    process.exit(1);
}
