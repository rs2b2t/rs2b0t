/** Pack walkability probe for curated 2004 travel edge endpoints.
 *  --pack=out/collision.lcnav.gz */

//   bun tools/nav/curated-travel-probe.ts
//   bun tools/nav/curated-travel-probe.ts --pack=out/collision.lcnav.gz
import fs from 'node:fs';
import { gunzipSync } from 'fflate';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { curatedTravelEdges } from '#/bot/event/webwalk/travelCatalog.js';

const packPath =
    process.argv.find(a => a.startsWith('--pack='))?.split('=')[1]
    ?? 'out/collision.lcnav.gz';

if (!fs.existsSync(packPath)) {
    console.error(`missing ${packPath}`);
    process.exit(2);
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);

const edges = curatedTravelEdges();
let bad = 0;
let ok = 0;
for (const e of edges) {
    const fw = finder.walkable(e.from.x, e.from.z, e.from.level);
    const tw = finder.walkable(e.to.x, e.to.z, e.to.level);
    const status = fw && tw ? 'OK  ' : 'MISS';
    if (!(fw && tw)) {
        bad++;
    } else {
        ok++;
    }
    console.log(
        `${status} ${e.debugName ?? e.locName}`
        + `  from ${e.from.x},${e.from.z},L${e.from.level}${fw ? '' : ' !walk'}`
        + `  to ${e.to.x},${e.to.z},L${e.to.level}${tw ? '' : ' !walk'}`
    );
}
console.log(`\ncurated-travel-probe: ${ok} walkable both ends, ${bad} missing (edges skipped at graph load)`);
process.exit(bad > 0 && ok === 0 ? 1 : 0);
