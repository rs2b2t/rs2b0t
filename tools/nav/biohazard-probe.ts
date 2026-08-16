/*  Biohazard (#234) stand-tile probe: pathfinds to every tile the module names, from the regions the quest starts a leg in.
 *  Why: the headquarters first floor is reachable only over stairEdges.json behind a refused door, and a stand beside an unwalkable loc is not automatically pathable. */
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '../../src/bot/event/webwalk/data/doors.json';
import stairsJson from '../../src/bot/event/webwalk/data/stairEdges.json';
import transportsJson from '../../src/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/event/webwalk/PathFinder.js';
import { BIO_TILE } from '../../src/bot/api/ai/quests/defs/biohazard/areas.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson);

// Why: the mourner headquarters is a sealed pocket — its door is SCRIPT_REFUSED, so the
// building and its first floor form their own region that only the quest's own crossing enters.
const SEEDS: [string, NavPoint][] = [
    ['ardougne', { x: 2616, z: 3332, level: 0 }],
    ['westArdougne', { x: 2529, z: 3304, level: 0 }],
    ['varrock', { x: 3212, z: 3428, level: 0 }],
    ['rimmington', { x: 2957, z: 3210, level: 0 }],
    ['mournerHq', { x: 2551, z: 3321, level: 0 }]
];

let bad = 0;
const stands = Object.entries(BIO_TILE) as [string, NavPoint][];
for (const [label, tile] of stands) {
    const walkable = finder.walkable(tile.x, tile.z, tile.level);
    const from = SEEDS.filter(([, seed]) => finder.findPath(seed, tile, undefined, 2_000_000).ok).map(([name]) => name);
    if (from.length === 0) {
        bad++;
    }
    console.log(
        `${from.length === 0 ? 'BAD ' : 'ok  '} ${label.padEnd(22)} (${tile.x},${tile.z},${tile.level})`
        + ` walkable=${walkable ? 'y' : 'n'} from=[${from.join(',') || 'nothing'}]`
    );
}
console.log(`\n${bad} of ${stands.length} stand tiles cannot be pathed to from any region`);
