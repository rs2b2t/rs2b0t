/**
 * Pack-level regression over tools/nav/mainland-routes.json
 *
 *   bun tools/nav/mainland-corpus.ts
 *   bun tools/nav/mainland-corpus.ts --explain
 */
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData } from '#/bot/nav/PathFinder.js';
import { formatHops } from '#/bot/nav/v2/hops.js';

const explain = process.argv.includes('--explain');
const packPath = 'out/collision.lcnav.gz';
const corpus = JSON.parse(fs.readFileSync('tools/nav/mainland-routes.json', 'utf8')) as {
    routes: { id: string; from: { x: number; z: number; level: number }; to: { x: number; z: number; level: number }; note: string }[];
};

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson as never);

let fail = 0;
for (const r of corpus.routes) {
    const outcome = finder.findPath(r.from, r.to, { policy: { useTeleports: false } });
    if (!outcome.ok) {
        console.log(`FAIL ${r.id} ${r.note}: ${outcome.reason}`);
        fail++;
        continue;
    }
    console.log(`PASS ${r.id} cost=${outcome.cost} hops=${outcome.hops.length} — ${r.note}`);
    if (explain && outcome.hops.length) {
        console.log(formatHops(outcome.hops));
    }
}
console.log(fail === 0 ? `all ${corpus.routes.length} routes ok` : `${fail}/${corpus.routes.length} failed`);
process.exit(fail === 0 ? 0 : 1);
