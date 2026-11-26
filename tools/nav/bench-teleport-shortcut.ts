import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder, type PathOutcome } from '#/bot/event/webwalk/PathFinder.js';

const exits = 13;
const walkable = exits + 4096;
const pack = new Uint8Array(walkable + 512 + 2048);
pack.set([0x4c, 0x43, 0x4e, 0x56, 2, 0, 0, 0, 1, 0, 50, 53, 1]);
pack.fill(0xff, walkable, walkable + 512);
const east = (x: number, z: number) => { pack[exits + (x & 63) * 64 + (z & 63)] = 2; };
east(3201, 3430);
for (let x = 3213; x < 3243; x++) east(x, 3424);

const finder = new PathFinder(pack);
const from = { x: 3201, z: 3430, level: 0 };
const to = { x: 3243, z: 3424, level: 0 };
finder.addEdges([], [{ from: { ...from, x: 3202 }, to, locName: 'Tunnel', action: 'Enter', kind: 'shortcut' }]);
const state = { members: true, skills: { magic: 25 }, quests: {}, freeSlots: 25, items: { 'Law rune': 1, 'Fire rune': 1, 'Air rune': 3 } };

function measure(label: string, search: () => PathOutcome, batches: number, batchSize: number): void {
    const first = search();
    const expected = JSON.stringify(first);
    for (let i = 0; i < batchSize; i++) search();
    const times: number[] = [];
    for (let i = 0; i < batches; i++) {
        const results: PathOutcome[] = [];
        const start = performance.now();
        for (let j = 0; j < batchSize; j++) results.push(search());
        times.push((performance.now() - start) / batchSize);
        if (results.some(result => JSON.stringify(result) !== expected)) throw new Error(label);
    }
    const ms = times.sort((a, b) => a - b)[batches >> 1];
    const outcome = first.ok ? {
        cost: first.cost,
        hops: first.hops.map(h => h.kind),
        path: createHash('sha256').update(JSON.stringify([first.waypoints, first.hops])).digest('hex')
    } : { reason: first.reason };
    console.log(JSON.stringify({ label, batches, batchSize, medianMs: ms, expanded: first.expanded, ...outcome }));
}

for (const [useShortcuts, useTeleportCatalog, maxExpansions] of [
    [true, true, 100], [true, true, 10], [false, true, 100], [true, false, 100]
] as const) {
    const opts = { state, policy: { useShortcuts, useTeleports: true }, useTeleportCatalog, maxExpansions };
    measure(`shortcuts=${useShortcuts} catalog=${useTeleportCatalog} budget=${maxExpansions}`, () => finder.findPath(from, to, opts), 61, 20);
}

const packPath = process.argv[2];
if (packPath) {
    const full = new PathFinder(gunzipSync(readFileSync(packPath)));
    loadDefaultNavEdges(full);
    console.log(`${full.mapsquares} mapsquares, ${full.doorEdges} doors, ${full.transportEdges} transports`);
    const options = {
        state: {
            members: true, skills: { magic: 99, Magic: 99 }, freeSlots: 20,
            quests: { 'Plague City': 'complete', Watchtower: 'complete', "Eadgar's Ruse": 'complete' },
            items: { 'Law rune': 100, 'Air rune': 100, 'Fire rune': 100, 'Water rune': 100, 'Earth rune': 100 }
        },
        policy: { useTeleports: true, distanceBeforeTeleport: 0 },
        useTeleportCatalog: true
    } as const;
    const routes = [
        ['Falador to Varrock', 3013, 3355, 3253, 3420],
        ['Varrock to mine', 3253, 3420, 3285, 3366],
        ['Rimmington to bank', 2978, 3247, 3013, 3355],
        ['Catherby to Seers', 2808, 3440, 2725, 3488],
        ['Lumbridge to Catherby', 3222, 3218, 2808, 3440],
        ['Wilderness to Falador', 3126, 3773, 3013, 3355],
        ['Lumbridge to Yanille', 3222, 3218, 2612, 3093]
    ] as const;
    for (const [label, x, z, endX, endZ] of routes) {
        const from = { x, z, level: 0 };
        const to = { x: endX, z: endZ, level: 0 };
        measure(label, () => full.findPath(from, to, options), 5, 1);
    }
    const bank = { x: 3253, z: 3420, level: 0 };
    measure('One-step bank walk', () => full.findPath(bank, { ...bank, x: 3254 }, options), 61, 10);
    measure('Yanille budget=5000', () => full.findPath({ x: 3222, z: 3218, level: 0 }, { x: 2612, z: 3093, level: 0 }, {
        ...options, maxExpansions: 5000
    }), 5, 1);
}
