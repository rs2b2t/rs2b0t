/** Pack-level regression over curated mainland legs only: bun --preload ./test/setup-dom.ts tools/nav/mainland-corpus.ts [--explain].
 *  A thin filter over the shared path corpus (same builder and path dedupe as script-route-corpus, which is the tool for the full mesh / hardest precalc). */

//   bun --preload ./test/setup-dom.ts tools/nav/mainland-corpus.ts
//   bun --preload ./test/setup-dom.ts tools/nav/mainland-corpus.ts --explain
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { formatHops } from '#/bot/event/webwalk/hops.js';

import { buildScriptRoutes } from './script-route-corpus.js';

const explain = process.argv.includes('--explain');
const packPath = 'out/collision.lcnav.gz';

// Mainland JSON is source of truth for these legs; buildScriptRoutes already
// injects them first and path-dedupes anything that would shadow them.
const routes = buildScriptRoutes().filter(r => r.source === 'mainland-routes.json');
if (routes.length === 0) {
    console.error('no mainland-routes.json legs in corpus — is tools/nav/mainland-routes.json present?');
    process.exit(2);
}

if (!fs.existsSync(packPath)) {
    console.error(`missing ${packPath} — run collision pack build first`);
    process.exit(2);
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);

let fail = 0;
for (const r of routes) {
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
console.log(fail === 0 ? `all ${routes.length} mainland paths ok` : `${fail}/${routes.length} failed`);
process.exit(fail === 0 ? 0 : 1);
