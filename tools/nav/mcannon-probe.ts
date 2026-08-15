/** Probe every tile the Dwarf Cannon module names against the baked collision pack: walkability, then which of them share a component.
 *  Why: the goblin cave is entered and left by scripted telejumps that no transports edge carries, so a walk that looks fine on the map may be crossing a boundary nothing routes over. */
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '../../src/bot/event/webwalk/data/doors.json';
import stairsJson from '../../src/bot/event/webwalk/data/stairEdges.json';
import transportsJson from '../../src/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/event/webwalk/PathFinder.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson);

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const nodeId = (x: number, z: number, level: number): number => (level << 28) | (x << 14) | z;

function flood(p: NavPoint, cap = 400_000): Set<number> {
    const start = nodeId(p.x, p.z, p.level);
    const seen = new Set<number>([start]);
    const stack = [start];
    while (stack.length > 0 && seen.size < cap) {
        const cur = stack.pop()!;
        const x = (cur >> 14) & 0x3fff;
        const z = cur & 0x3fff;
        const level = (cur >> 28) & 0x3;
        const mask = finder.exitMask(x, z, level);
        for (let d = 0; d < 8; d++) {
            if ((mask & (1 << d)) === 0) {
                continue;
            }
            const id = nodeId(x + DX[d], z + DZ[d], level);
            if (!seen.has(id)) {
                seen.add(id);
                stack.push(id);
            }
        }
    }
    return seen;
}

const TILES: Record<string, NavPoint> = {
    faladorBank: { x: 2946, z: 3369, level: 0 },
    commander: { x: 2571, z: 3463, level: 0 },
    railing1: { x: 2556, z: 3475, level: 0 },
    railing2: { x: 2558, z: 3472, level: 0 },
    railing3: { x: 2557, z: 3464, level: 0 },
    railing4: { x: 2559, z: 3462, level: 0 },
    railing5: { x: 2564, z: 3460, level: 0 },
    railing6: { x: 2572, z: 3460, level: 0 },
    towerLadderBase: { x: 2570, z: 3441, level: 0 },
    towerL1Land: { x: 2570, z: 3441, level: 1 },
    towerL1Ladder: { x: 2570, z: 3443, level: 1 },
    towerL2Land: { x: 2570, z: 3443, level: 2 },
    remains: { x: 2567, z: 3444, level: 2 },
    caveEntrance: { x: 2622, z: 3392, level: 0 },
    caveArrive: { x: 2620, z: 9797, level: 0 },
    crate: { x: 2571, z: 9850, level: 0 },
    mudPile: { x: 2621, z: 9796, level: 0 },
    mudExit: { x: 2623, z: 3391, level: 0 },
    shedDoor: { x: 2576, z: 3461, level: 0 },
    cannon: { x: 2577, z: 3461, level: 0 },
    nulodionDoor: { x: 3015, z: 3453, level: 0 },
    nulodion: { x: 3011, z: 3453, level: 0 }
};

console.log('--- walkability ---');
const walkable: Record<string, boolean> = {};
for (const [name, p] of Object.entries(TILES)) {
    walkable[name] = finder.exitMask(p.x, p.z, p.level) !== 0;
    console.log(`${walkable[name] ? 'walk    ' : 'BLOCKED '} ${name.padEnd(16)} (${p.x},${p.z},${p.level})`);
}

console.log('\n--- components (walk only; exitMask does not cross door edges) ---');
const seen = new Set<string>();
for (const [seed, p] of Object.entries(TILES)) {
    if (!walkable[seed] || seen.has(seed)) {
        continue;
    }
    const set = flood(p);
    const inside = Object.entries(TILES)
        .filter(([, q]) => set.has(nodeId(q.x, q.z, q.level)))
        .map(([n]) => n);
    for (const n of inside) {
        seen.add(n);
    }
    console.log(`[${set.size.toString().padStart(6)} tiles] ${inside.join(', ')}`);
}

console.log('\n--- routes (findPath: doors, stairs and transports all in play) ---');
const LEGS: [string, string][] = [
    ['faladorBank', 'commander'],
    ['commander', 'railing1'],
    ['railing1', 'railing6'],
    ['commander', 'towerLadderBase'],
    ['towerLadderBase', 'caveEntrance'],
    ['caveArrive', 'crate'],
    ['crate', 'mudPile'],
    ['mudExit', 'commander'],
    ['commander', 'cannon'],
    ['commander', 'nulodion'],
    ['nulodion', 'faladorBank'],
    ['caveArrive', 'faladorBank']
];
for (const [a, b] of LEGS) {
    const r = finder.findPath(TILES[a], TILES[b]);
    const detail = r.ok
        ? `cost ${Math.round(r.cost)}, ${r.waypoints.length} waypoints, hops [${r.hops.map(h => h.kind ?? '?').join(', ')}]`
        : r.reason;
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${a} → ${b}: ${detail}`);
}

console.log('\n--- walkable neighbours of each ladder loc ---');
for (const [name, p] of Object.entries({
    ladderL0: { x: 2570, z: 3441, level: 0 },
    ladderUpL1: { x: 2570, z: 3443, level: 1 },
    landingL1: { x: 2570, z: 3441, level: 1 },
    landingL2: { x: 2570, z: 3443, level: 2 }
})) {
    const open: string[] = [];
    for (let d = 0; d < 8; d++) {
        const x = p.x + DX[d];
        const z = p.z + DZ[d];
        if (finder.exitMask(x, z, p.level) !== 0) {
            open.push(`${x},${z}`);
        }
    }
    console.log(`${name.padEnd(10)} (${p.x},${p.z},${p.level}) → ${open.join('  ') || 'none'}`);
}
