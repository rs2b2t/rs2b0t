/** Find safe tiles for defs/familycrest/chronozon.ts by flooding size-3 NPC positions and excluding tiles the demon can touch.
 * Why: the x=3082 passage is sealed; seed inside the chamber since exitMask cannot cross the gates. */

//   bun tools/nav/chronozon-safespot.ts
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const finder = new PathFinder(bytes);

const SPAWN = { x: 3087, z: 9937 };
const SIZE = 3;
const CAST_RANGE = 10;

const walk = (x: number, z: number): boolean => finder.walkable(x, z, 0);

/** Origin (south-west) placement of a size-3 npc. */
const fits = (ox: number, oz: number): boolean => {
    for (let dx = 0; dx < SIZE; dx++) {
        for (let dz = 0; dz < SIZE; dz++) {
            if (!walk(ox + dx, oz + dz)) return false;
        }
    }
    return true;
};

// Flood legal NPC origins; diagonal moves need both cardinal moves.
const spawnOrigin = { x: SPAWN.x - 1, z: SPAWN.z - 1 };
const reach = new Set<string>();
if (fits(spawnOrigin.x, spawnOrigin.z)) {
    const q = [spawnOrigin];
    reach.add(`${spawnOrigin.x},${spawnOrigin.z}`);
    while (q.length) {
        const o = q.pop()!;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
            const nx = o.x + dx, nz = o.z + dz;
            const k = `${nx},${nz}`;
            if (reach.has(k) || !fits(nx, nz)) continue;
            if (Math.max(Math.abs(nx + 1 - SPAWN.x), Math.abs(nz + 1 - SPAWN.z)) > 12) continue;
            reach.add(k);
            q.push({ x: nx, z: nz });
        }
    }
}
console.log(`demon can occupy ${reach.size} placements`);

const origins = [...reach].map(k => { const [x, z] = k.split(',').map(Number); return { x: x!, z: z! }; });

/** Tiles covered by or adjacent to the demon's body. */
const body = new Set<string>();
const touched = new Set<string>();
for (const o of origins) {
    for (let dx = 0; dx < SIZE; dx++) {
        for (let dz = 0; dz < SIZE; dz++) body.add(`${o.x + dx},${o.z + dz}`);
    }
    for (let x = o.x - 1; x <= o.x + SIZE; x++) {
        for (let z = o.z - 1; z <= o.z + SIZE; z++) touched.add(`${x},${z}`);
    }
}

// A walkable tile can still be a sealed island; flood the entrance component first.
const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
// Why: exitMask cannot cross the gates, so seed inside the chamber.
const ENTRY = { x: 3087, z: 9938 };
const reachable = new Set<string>([`${ENTRY.x},${ENTRY.z}`]);
{
    const stack = [ENTRY];
    while (stack.length) {
        const t = stack.pop()!;
        const mask = finder.exitMask(t.x, t.z, 0);
        for (let d = 0; d < 8; d++) {
            if ((mask & (1 << d)) === 0) continue;
            const nx = t.x + DX[d]!, nz = t.z + DZ[d]!;
            if (Math.abs(nx - SPAWN.x) > 20 || Math.abs(nz - SPAWN.z) > 20) continue;
            const k = `${nx},${nz}`;
            if (!reachable.has(k)) { reachable.add(k); stack.push({ x: nx, z: nz }); }
        }
    }
}
console.log(`entrance component: ${reachable.size} tiles`);

const safe: { x: number; z: number; nearest: number }[] = [];
for (let x = SPAWN.x - 14; x <= SPAWN.x + 14; x++) {
    for (let z = SPAWN.z - 14; z <= SPAWN.z + 14; z++) {
        if (!reachable.has(`${x},${z}`) || touched.has(`${x},${z}`)) continue;
        // must still be able to hit something the demon can stand on
        let nearest = Infinity;
        for (const b of body) {
            const [bx, bz] = b.split(',').map(Number);
            nearest = Math.min(nearest, Math.max(Math.abs(bx! - x), Math.abs(bz! - z)));
        }
        if (nearest <= CAST_RANGE) safe.push({ x, z, nearest });
    }
}
safe.sort((a, b) => a.nearest - b.nearest);
console.log(`${safe.length} safespots within cast range; closest first:`);
for (const s of safe.slice(0, 15)) {
    console.log(`  (${s.x}, ${s.z})  nearest demon tile ${s.nearest}`);
}
