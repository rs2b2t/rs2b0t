/** Derive the Taverley blue dragon safespots and melee anchor, which feed DRAGON_SITES in scripts/JiveDragons/sites.ts.
 *  Why: walkable is not reachable and a size-4 body slides six tiles off its spawn, so the melee-proof set has to come from the collision pack rather than from looking at the map. */

//   bun tools/nav/jive-dragon-safespots.ts
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const finder = new PathFinder(bytes);

const LEVEL = 0;
const MAXRANGE = 6;
const CAST_RANGE = 10;
const GATE_INSIDE = { x: 2923, z: 9803 };

// Why: a `0 dx dz: id` row in maps/m45_153.jm2 is world (2880 + dx, 9792 + dz), and the coordinate is the south-west corner of the footprint, not its middle.
const SPAWNS = [
    { x: 2897, z: 9797, size: 4, adult: true },
    { x: 2899, z: 9802, size: 4, adult: true },
    { x: 2904, z: 9802, size: 4, adult: true },
    { x: 2892, z: 9799, size: 2, adult: false },
    { x: 2904, z: 9796, size: 2, adult: false },
    { x: 2909, z: 9806, size: 2, adult: false },
    { x: 2911, z: 9797, size: 2, adult: false },
    { x: 2911, z: 9808, size: 2, adult: false },
    { x: 2917, z: 9801, size: 2, adult: false }
];

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const WALL_N = 1, WALL_E = 2, WALL_S = 4, WALL_W = 8;

const walk = (x: number, z: number): boolean => finder.walkable(x, z, LEVEL);
const exit = (x: number, z: number): number => finder.exitMask(x, z, LEVEL);
const wall = (x: number, z: number): number => finder.wallMask(x, z, LEVEL);
const key = (x: number, z: number): string => `${x},${z}`;
const parse = (k: string): [number, number] => k.split(',').map(Number) as [number, number];
const cheb = (ax: number, az: number, bx: number, bz: number): number => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

/** Whether a size-N body placed with its south-west corner here stands on solid ground. */
function fits(ox: number, oz: number, size: number): boolean {
    for (let dx = 0; dx < size; dx++) {
        for (let dz = 0; dz < size; dz++) {
            if (!walk(ox + dx, oz + dz)) return false;
        }
    }
    return true;
}

// Why: a body only slides when every tile on its leading edge carries the exit flag, so one blocked corner pins the footprint.
function canSlide(ox: number, oz: number, size: number, dir: number): boolean {
    const bit = 1 << dir;
    for (let i = 0; i < size; i++) {
        const x = dir === 1 ? ox + size - 1 : dir === 3 ? ox : ox + i;
        const z = dir === 0 ? oz + size - 1 : dir === 2 ? oz : oz + i;
        if ((exit(x, z) & bit) === 0) return false;
    }
    return true;
}

interface Wander {
    spawn: (typeof SPAWNS)[number];
    placements: number;
    body: Set<string>;
    threat: Set<string>;
}

/** Every footprint origin the npc can reach inside `maxrange`, then the tiles it covers and the tiles it can hit from them. */
function wander(spawn: (typeof SPAWNS)[number]): Wander {
    const seen = new Set<string>();
    const body = new Set<string>();
    const queue: { x: number; z: number }[] = [];
    if (fits(spawn.x, spawn.z, spawn.size)) {
        seen.add(key(spawn.x, spawn.z));
        queue.push({ x: spawn.x, z: spawn.z });
    }
    let placements = 0;
    while (queue.length > 0) {
        const o = queue.pop()!;
        placements++;
        for (let dx = 0; dx < spawn.size; dx++) {
            for (let dz = 0; dz < spawn.size; dz++) body.add(key(o.x + dx, o.z + dz));
        }
        for (let dir = 0; dir < 4; dir++) {
            const nx = o.x + DX[dir]!, nz = o.z + DZ[dir]!;
            if (seen.has(key(nx, nz)) || cheb(nx, nz, spawn.x, spawn.z) > MAXRANGE) continue;
            if (!canSlide(o.x, o.z, spawn.size, dir) || !fits(nx, nz, spawn.size)) continue;
            seen.add(key(nx, nz));
            queue.push({ x: nx, z: nz });
        }
    }
    const threat = new Set<string>();
    for (const b of body) {
        const [bx, bz] = parse(b);
        const mask = exit(bx, bz);
        for (let dir = 0; dir < 4; dir++) {
            if (mask & (1 << dir)) threat.add(key(bx + DX[dir]!, bz + DZ[dir]!));
        }
    }
    for (const b of body) threat.delete(b);
    return { spawn, placements, body, threat };
}

const openX = (x: number, z: number, step: number): boolean =>
    (wall(x, z) & (step > 0 ? WALL_E : WALL_W)) === 0
    && (wall(x + step, z) & (step > 0 ? WALL_W : WALL_E)) === 0
    && walk(x + step, z);

const openZ = (x: number, z: number, step: number): boolean =>
    (wall(x, z) & (step > 0 ? WALL_N : WALL_S)) === 0
    && (wall(x, z + step) & (step > 0 ? WALL_S : WALL_N)) === 0
    && walk(x, z + step);

// Why: the engine casts the ray along the longer axis and only shifts the short axis when the scaled fraction rolls over, so a diagonal that looks clear can still enter a rock tile.
function sees(x0: number, z0: number, x1: number, z1: number): boolean {
    const dx = x1 - x0, dz = z1 - z0;
    let x = x0, z = z0;
    if (Math.abs(dx) >= Math.abs(dz)) {
        if (dx === 0) return true;
        const xStep = dx > 0 ? 1 : -1, zStep = dz > 0 ? 1 : -1;
        let scaled = (z0 << 16) + 0x8000;
        const slope = Math.trunc((dz << 16) / Math.abs(dx));
        while (x !== x1) {
            if (!openX(x, z, xStep)) return false;
            x += xStep;
            scaled += slope;
            const next = scaled >> 16;
            if (next !== z) {
                if (!openZ(x, z, zStep)) return false;
                z = next;
            }
        }
        return true;
    }
    const xStep = dx > 0 ? 1 : -1, zStep = dz > 0 ? 1 : -1;
    let scaled = (x0 << 16) + 0x8000;
    const slope = Math.trunc((dx << 16) / Math.abs(dz));
    while (z !== z1) {
        if (!openZ(x, z, zStep)) return false;
        z += zStep;
        scaled += slope;
        const next = scaled >> 16;
        if (next !== x) {
            if (!openX(x, z, xStep)) return false;
            x = next;
        }
    }
    return true;
}

const wanders = SPAWNS.map(wander);
for (const w of wanders) {
    console.log(`${w.spawn.adult ? 'adult' : 'baby '} spawn (${w.spawn.x}, ${w.spawn.z}) size ${w.spawn.size}: ${w.placements} placements, ${w.body.size} body tiles, ${w.threat.size} tiles it can hit`);
}

const adults = wanders.filter(w => w.spawn.adult);
const allBody = new Set<string>();
const adultBody = new Set<string>();
const adultThreat = new Set<string>();
const babyThreat = new Set<string>();
for (const w of wanders) {
    for (const b of w.body) {
        allBody.add(b);
        if (w.spawn.adult) adultBody.add(b);
    }
    for (const t of w.threat) (w.spawn.adult ? adultThreat : babyThreat).add(t);
}
console.log(`bodies ${allBody.size} (${adultBody.size} adult), threatened ${adultThreat.size} by an adult, ${babyThreat.size} by a baby`);

const reachable = new Set<string>([key(GATE_INSIDE.x, GATE_INSIDE.z)]);
{
    const stack = [GATE_INSIDE];
    while (stack.length > 0) {
        const t = stack.pop()!;
        const mask = exit(t.x, t.z);
        for (let dir = 0; dir < 8; dir++) {
            if ((mask & (1 << dir)) === 0) continue;
            const nx = t.x + DX[dir]!, nz = t.z + DZ[dir]!;
            if (reachable.has(key(nx, nz))) continue;
            reachable.add(key(nx, nz));
            stack.push({ x: nx, z: nz });
        }
    }
}
console.log(`${reachable.size} tiles reachable from the gate's inside tile (${GATE_INSIDE.x}, ${GATE_INSIDE.z})`);

const safespots: { x: number; z: number; range: number }[] = [];
for (const k of reachable) {
    if (allBody.has(k) || adultThreat.has(k) || babyThreat.has(k)) continue;
    const [x, z] = parse(k);
    let range = Infinity;
    for (const b of adultBody) {
        const [bx, bz] = parse(b);
        const d = cheb(x, z, bx, bz);
        if (d < range && d <= CAST_RANGE && sees(x, z, bx, bz)) range = d;
    }
    if (range <= CAST_RANGE) safespots.push({ x, z, range });
}
safespots.sort((a, b) => a.range - b.range || a.x - b.x || a.z - b.z);
console.log(`${safespots.length} safespots: reachable, off every body, out of every threat set, and looking at an adult inside ${CAST_RANGE}`);
for (const s of safespots.slice(0, 12)) console.log(`  (${s.x}, ${s.z})  sees an adult ${s.range} away`);

const anchors: { x: number; z: number; spawns: number; tiles: number }[] = [];
for (const k of reachable) {
    if (allBody.has(k) || babyThreat.has(k)) continue;
    const [x, z] = parse(k);
    let spawns = 0, tiles = 0;
    for (const w of adults) {
        let touched = 0;
        for (const b of w.body) {
            const [bx, bz] = parse(b);
            if (cheb(x, z, bx, bz) === 1) touched++;
        }
        if (touched > 0) spawns++;
        tiles += touched;
    }
    if (spawns > 0) anchors.push({ x, z, spawns, tiles });
}
anchors.sort((a, b) => b.spawns - a.spawns || b.tiles - a.tiles || a.x - b.x || a.z - b.z);
console.log(`${anchors.length} melee anchors: off every body, out of every baby's reach, touching an adult at range 1`);
for (const a of anchors) console.log(`  (${a.x}, ${a.z})  ${a.spawns} of ${adults.length} adult spawns, ${a.tiles} body tiles at range 1`);

const anchor = anchors[0];
if (!anchor) {
    console.log('no melee anchor survives; melee cannot hold a tile here');
} else {
    console.log(`melee anchor (${anchor.x}, ${anchor.z})`);
    const flanking = safespots.filter(s => cheb(s.x, s.z, anchor.x, anchor.z) <= 2);
    console.log(`safespots within 2 of it: ${flanking.map(s => `(${s.x}, ${s.z})`).join(' ')}`);
}
