/** Offline pack view of one patch of ground: a walkability grid around a tile, and the waypoints a path from it takes.
 *  Why: a stand the pack calls walkable can still sit where the live client refuses every click, and the first thing to check is which tiles the two disagree on. */

//   bun tools/nav/walkable-box.ts --at 2854,2974,0 --radius 6 --to 2870,2971,0
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';

function parseTile(s: string): NavPoint {
    const [x, z, level] = s.split(',').map(Number);
    if ([x, z, level].some(n => Number.isNaN(n))) {
        throw new Error(`bad tile ${s}`);
    }
    return { x: x!, z: z!, level: level! };
}

const args = process.argv.slice(2);
let packPath = 'out/collision.lcnav.gz';
let at: NavPoint = { x: 2854, z: 2974, level: 0 };
let to: NavPoint | null = null;
let radius = 6;
for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--pack') {
        packPath = args[++i]!;
    } else if (a === '--at') {
        at = parseTile(args[++i]!);
    } else if (a === '--to') {
        to = parseTile(args[++i]!);
    } else if (a === '--radius') {
        radius = Number(args[++i]);
    }
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);

const onPath = new Set<string>();
if (to) {
    const outcome = finder.findPath(at, to, { policy: { useTeleports: false } });
    if (outcome.ok) {
        console.log(`path to ${to.x},${to.z}: cost ${outcome.cost}, waypoints ${outcome.waypoints.map(w => `${w.x},${w.z}`).join(' > ')}`);
        for (const w of outcome.waypoints) {
            onPath.add(`${w.x},${w.z}`);
        }
    } else {
        console.log(`no path to ${to.x},${to.z}: ${outcome.reason}`);
    }
}

console.log(`walkability around ${at.x},${at.z} level ${at.level} (# blocked, . open, * path, @ the tile), north at the top`);
for (let z = at.z + radius; z >= at.z - radius; z--) {
    let row = `${String(z).padStart(5)} `;
    for (let x = at.x - radius; x <= at.x + radius; x++) {
        const open = finder.walkable(x, z, at.level);
        const key = `${x},${z}`;
        row += x === at.x && z === at.z ? '@' : onPath.has(key) ? '*' : open ? '.' : '#';
    }
    console.log(row);
}
let axis = '      ';
for (let x = at.x - radius; x <= at.x + radius; x++) {
    axis += String(x % 10);
}
console.log(axis);
