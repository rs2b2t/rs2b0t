/** Offline path probe with optional --explain hops (nav-v2 Phase 4).
 *  --from 3222,3218,0 --to 2965,3378,0 [--explain] [--tele --magic 99 --runes] */

//   bun tools/nav/route-probe.ts --from 3222,3218,0 --to 2965,3378,0 --explain
//   bun tools/nav/route-probe.ts --from 3019,9849,0 --to 2965,3378,0 --explain
//   bun tools/nav/route-probe.ts --from 3222,3218,0 --to 3213,3424,0 --tele --magic 99 --runes
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { formatHops } from '#/bot/event/webwalk/hops.js';
import type { PathPolicy } from '#/bot/event/webwalk/types.js';
import type { WorldStateData } from '#/bot/event/webwalk/worldStateData.js';

function parseTile(s: string): NavPoint {
    const [x, z, level] = s.split(',').map(Number);
    if ([x, z, level].some(n => Number.isNaN(n))) {
        throw new Error(`bad tile ${s}`);
    }
    return { x: x!, z: z!, level: level! };
}

const args = process.argv.slice(2);
let packPath = 'out/collision.lcnav.gz';
let from = { x: 3222, z: 3218, level: 0 };
let to = { x: 2965, z: 3378, level: 0 };
let explain = false;
let useTele = false;
let magic = 1;
let withRunes = false;
let distanceBeforeTeleport = 0;

for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--pack') {
        packPath = args[++i]!;
    } else if (a === '--from') {
        from = parseTile(args[++i]!);
    } else if (a === '--to') {
        to = parseTile(args[++i]!);
    } else if (a === '--explain') {
        explain = true;
    } else if (a === '--tele') {
        useTele = true;
    } else if (a === '--magic') {
        magic = Number(args[++i]);
    } else if (a === '--runes') {
        withRunes = true;
    } else if (a === '--distanceBeforeTeleport') {
        distanceBeforeTeleport = Number(args[++i]);
    }
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}

const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);
console.log(
    `pack: ${finder.mapsquares} mapsquares, ${finder.doorEdges} door edges, ${finder.transportEdges} transport edges (members=${finder.members})`
);
console.log(`from ${from.x},${from.z},L${from.level} → ${to.x},${to.z},L${to.level}`);

const state: WorldStateData | undefined = useTele
    ? {
        members: true,
        skills: { magic, Magic: magic },
        quests: {
            'Plague City': 'complete',
            'Watchtower': 'complete',
            "Eadgar's Ruse": 'complete'
        },
        items: withRunes
            ? {
                'Law rune': 100,
                'Air rune': 100,
                'Fire rune': 100,
                'Water rune': 100,
                'Earth rune': 100
            }
            : {},
        freeSlots: 20
    }
    : undefined;

const policy: PathPolicy | undefined = useTele
    ? { useTeleports: true, distanceBeforeTeleport }
    : { useTeleports: false };

const outcome = finder.findPath(from, to, {
    state,
    policy,
    useTeleportCatalog: useTele
});

if (!outcome.ok) {
    console.error(`NO PATH: ${outcome.reason} (expanded ${outcome.expanded})`);
    process.exit(1);
}

const doors = outcome.waypoints.filter(w => w.transport && !w.transport.teleportId && w.transport.toLevel === undefined && !w.transport.toTile).length;
const teles = outcome.waypoints.filter(w => w.transport?.teleportId).length;
console.log(
    `ok: cost ${outcome.cost}, ${outcome.waypoints.length} waypoints, ${doors} door-like, ${teles} tele hops, expanded ${outcome.expanded}`
);
if (explain) {
    console.log('hops:');
    console.log(formatHops(outcome.hops));
}
