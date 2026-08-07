import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import doorsJson from '../../src/bot/nav/data/doors.json';
import transportsJson from '../../src/bot/nav/data/transports.json';
import stairsJson from '../../src/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/nav/PathFinder.js';
import { WT_CAVES, WT_NIGHTSHADE, WT_TILE } from '../../src/bot/quests/defs/watchtower/areas.js';
import { ARDOUGNE_ADVENTURER, MAGIC_GUILD, OGRE_HERBLORE } from '../../src/bot/quests/defs/watchtower/supplies.js';

const SHOPS = { adventurer: ARDOUGNE_ADVENTURER, magicGuild: MAGIC_GUILD, ogreHerblore: OGRE_HERBLORE };

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson);

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const nodeId = (x: number, z: number, l: number) => (l << 28) | (x << 14) | z;
const edges: Map<number, { to: number }[]> = (finder as unknown as { edges: Map<number, { to: number }[]> }).edges;

function flood(p: NavPoint): Set<number> {
    const seen = new Set<number>();
    const stack = [nodeId(p.x, p.z, p.level)];
    seen.add(stack[0]);
    while (stack.length) {
        const cur = stack.pop()!;
        const x = (cur >> 14) & 0x3fff, z = cur & 0x3fff, level = (cur >> 28) & 0x3;
        const mask = finder.exitMask(x, z, level);
        for (let d = 0; d < 8; d++) {
            if ((mask & (1 << d)) === 0) continue;
            const n = nodeId(x + DX[d], z + DZ[d], level);
            if (!seen.has(n)) { seen.add(n); stack.push(n); }
        }
        for (const e of edges.get(cur) ?? []) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); }
    }
    return seen;
}

const REGIONS: [string, NavPoint][] = [
    ['MAIN', { x: 2612, z: 3092, level: 0 }],
    ['grewIsland', { x: 2513, z: 3084, level: 0 }],
    ['tobanCamp', { x: 2576, z: 3027, level: 0 }],
    ['lowerCity', { x: 2526, z: 3018, level: 0 }],
    ['cityGuard', { x: 2541, z: 3029, level: 0 }],
    ['enclave', { x: 2588, z: 9410, level: 0 }],
    ['cave6Approach', { x: 2526, z: 3011, level: 0 }],
    // Each skavid cave is its own sealed room — there is no walking between them.
    ...WT_CAVES.map(cave => [`cave${cave.index}`, cave.landing as NavPoint] as [string, NavPoint])
];
const comps = REGIONS.map(([name, seed]) => ({ name, seed, set: flood(seed) }));
const regionOf = (p: NavPoint): string => comps.find(c => c.set.has(nodeId(p.x, p.z, p.level)))?.name ?? '???';

const stands: [string, NavPoint][] = [];
for (const [key, value] of Object.entries(WT_TILE)) {
    if (Array.isArray(value)) {
        value.forEach((tile, i) => stands.push([`${key}[${i}]`, tile as NavPoint]));
    } else {
        stands.push([key, value as NavPoint]);
    }
}
for (const cave of WT_CAVES) {
    stands.push([`cave${cave.index}.stand`, cave.stand]);
    stands.push([`cave${cave.index}.landing`, cave.landing]);
}
for (const [key, tile] of Object.entries(WT_NIGHTSHADE)) {
    stands.push([`nightshade.${key}`, tile as NavPoint]);
}
for (const [key, shop] of Object.entries(SHOPS)) {
    stands.push([`shop.${key}(${shop.npc})`, shop.anchor as NavPoint]);
}

// An unwalkable loc tile is fine to target — the walker snaps to a neighbour — but
// only if some region can actually path to it. Toban's cave mouth could not, because
// its one cardinal neighbour sits in a cut-off component.
let bad = 0;
for (const [label, tile] of stands) {
    const walkable = finder.walkable(tile.x, tile.z, tile.level);
    const reachableFrom = comps
        .filter(c => finder.findPath(c.seed, tile, undefined, 2_000_000).ok)
        .map(c => c.name);
    const flagged = reachableFrom.length === 0;
    if (flagged) {
        bad++;
    }
    console.log(`${flagged ? 'BAD ' : 'ok  '} ${label.padEnd(24)} (${tile.x},${tile.z},${tile.level}) walkable=${walkable ? 'y' : 'n'} pathable-from=[${reachableFrom.join(',') || 'nothing'}] region=${walkable ? regionOf(tile) : '-'}`);
}
console.log(`\n${bad} stand tiles cannot be pathed to from any known region`);
