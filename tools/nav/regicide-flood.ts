/**
 * Flood one pocket of the collision pack and report its extent plus the locs on its rim.
 * Why: Tirannwn is a dozen sealed pockets, and "the pack says this tile is walkable" says nothing about whether the pocket standing on it can be walked to.
 */

// bun tools/nav/regicide-flood.ts 2313,3215,0

import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

import { Reader, forEachLoc, loadMapsquares, loadLocTypes } from './lib.js';

const ENGINE = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/rs2b2t-engine`;
const [sx, sz, slevel] = (process.argv[2] ?? '2313,3215,0').split(',').map(Number);
const LIMIT = Number(process.argv[3] ?? 400_000);

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);

const DIRS = [
    [0, 1, 0x1],
    [1, 0, 0x2],
    [0, -1, 0x4],
    [-1, 0, 0x8]
] as const;

const seen = new Set<number>();
const key = (x: number, z: number): number => x * 100_000 + z;
const queue: [number, number][] = [[sx!, sz!]];
seen.add(key(sx!, sz!));
let minX = sx!;
let maxX = sx!;
let minZ = sz!;
let maxZ = sz!;

while (queue.length > 0 && seen.size < LIMIT) {
    const [x, z] = queue.shift()!;
    const mask = finder.exitMask(x, z, slevel!);
    for (const [dx, dz, bit] of DIRS) {
        if ((mask & bit) === 0) {
            continue;
        }
        const nx = x + dx;
        const nz = z + dz;
        const k = key(nx, nz);
        if (seen.has(k)) {
            continue;
        }
        seen.add(k);
        minX = Math.min(minX, nx);
        maxX = Math.max(maxX, nx);
        minZ = Math.min(minZ, nz);
        maxZ = Math.max(maxZ, nz);
        queue.push([nx, nz]);
    }
}

console.log(`pocket at (${sx},${sz},${slevel}): ${seen.size} tiles, x ${minX}-${maxX}, z ${minZ}-${maxZ}`);

const { names } = loadLocTypes(ENGINE);
const byId = new Map<number, string>();
for (const [name, id] of names) {
    byId.set(id, name);
}

const rim = new Map<string, string[]>();
for (const square of loadMapsquares(ENGINE)) {
    forEachLoc(new Reader(square.loc), loc => {
        const x = square.mx * 64 + loc.x;
        const z = square.mz * 64 + loc.z;
        if (x < minX - 3 || x > maxX + 3 || z < minZ - 3 || z > maxZ + 3) {
            return;
        }
        const name = byId.get(loc.locId) ?? String(loc.locId);
        if (!name.startsWith('regicide_') || /grass|tree|rock[0-9]|flower|mushroom|twig|swamp_|blue_|corpse|skull|bone|tent|standard|bridge_|spearwall|guiderope|crystal_lamp|roottree|hollowlog/.test(name)) {
            return;
        }
        // Why: a seam is only interesting when this pocket can stand next to it — and these are 3x2 locs, so the tile the crossing is launched from is up to two off the origin on both axes.
        let touching = false;
        for (let dx = -2; dx <= 3 && !touching; dx++) {
            for (let dz = -2; dz <= 3 && !touching; dz++) {
                touching = seen.has(key(x + dx, z + dz));
            }
        }
        if (!touching) {
            return;
        }
        const list = rim.get(name) ?? [];
        list.push(`(${x},${z})`);
        rim.set(name, list);
    });
}

for (const [name, at] of [...rim].sort()) {
    console.log(`  ${name.padEnd(34)} ${at.join(' ')}`);
}
