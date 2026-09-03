/** Derive the safespots and melee anchor of a Jive grind site, which feed sites.ts under scripts/JiveDragons, scripts/JiveDemons and scripts/JiveKBD.
 *  Why: walkable is not reachable and a multi-tile body slides several tiles off its spawn, so the melee-proof set has to come from the collision pack rather than from looking at the map. */

//   bun tools/nav/jive-safespots.ts [--target blue|demon|kbd] [--content ~/code/rs2b2t-content]
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

const argVal = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

export const PACK = 'out/collision.lcnav.gz';
export const MAPS = path.join(argVal('--content') ?? process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content'), 'maps');

const LEVEL = 0;
const CAST_RANGE = 10;
const GATE_INSIDE = { x: 2923, z: 9803 };
const LADDER_BOTTOM = { x: 2884, z: 9798 };

export interface Target {
    /** The map squares the spawns are read from. */
    squares: string[];
    adult: { id: number; size: number };
    /** A smaller body whose reach the safespots also avoid; `maxrange` falls back to the adult's. */
    baby: { id: number; size: number; maxrange?: number } | null;
    /** What the engine clamps the npc's movement with. */
    maxrange: number;
    /** The tile the site region floods from. */
    inside: { x: number; z: number };
    /** A tile on the wrong side of the gate, whose region a site area must stay out of. */
    outside: { x: number; z: number };
}

// Why: m45_152 holds the three babies south of z 9792.
// Why: the answer moves with maxrange: at the wanderrange of 4 the winning anchor is (2903, 9806), which borders two adult spawns instead of one.
export const BLUE_DRAGON: Target = { squares: ['m45_153', 'm45_152'], adult: { id: 55, size: 4 }, baby: { id: 52, size: 2 }, maxrange: 6, inside: GATE_INSIDE, outside: LADDER_BOTTOM };
export const BLACK_DEMON: Target = { squares: ['m44_152'], adult: { id: 84, size: 3 }, baby: null, maxrange: 9, inside: GATE_INSIDE, outside: LADDER_BOTTOM };
// Why: the lair's own spiders are ice spiders, wander 10 and clamped at 12; the poison spiders sit in the dungeon by the in-lever, outside this square.
export const KING_BLACK_DRAGON: Target = { squares: ['m42_153'], adult: { id: 50, size: 5 }, baby: { id: 64, size: 1, maxrange: 12 }, maxrange: 20, inside: { x: 2717, z: 9802 }, outside: { x: 3067, z: 10254 } };

export const TARGETS: Record<string, Target> = { blue: BLUE_DRAGON, demon: BLACK_DEMON, kbd: KING_BLACK_DRAGON };

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const WALL_N = 1, WALL_E = 2, WALL_S = 4, WALL_W = 8;

const key = (x: number, z: number): string => `${x},${z}`;
const parse = (k: string): [number, number] => k.split(',').map(Number) as [number, number];
const cheb = (ax: number, az: number, bx: number, bz: number): number => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

export interface Spawn {
    x: number;
    z: number;
    size: number;
    adult: boolean;
}

export interface Wander {
    spawn: Spawn;
    placements: number;
    body: Set<string>;
    threat: Set<string>;
}

export interface Safespot {
    x: number;
    z: number;
    range: number;
}

export interface Anchor {
    x: number;
    z: number;
    spawns: number;
    tiles: number;
}

export interface Derivation {
    spawns: Spawn[];
    wanders: Wander[];
    bodies: number;
    adultBodies: number;
    reachable: Set<string>;
    /** Every tile the ladder side of the gate reaches, none of which a site area may hold. */
    outside: Set<string>;
    safespots: Safespot[];
    anchors: Anchor[];
    anchor: Anchor;
    flanking: Safespot[];
}

export function inputsPresent(target = BLUE_DRAGON, maps = MAPS): boolean {
    return fs.existsSync(PACK) && target.squares.every(s => fs.existsSync(path.join(maps, `${s}.jm2`)));
}

/** Read the spawns straight out of the .jm2 NPC sections, so a moved npc shows up as a moved tile. */
export function readSpawns(target = BLUE_DRAGON, maps = MAPS): Spawn[] {
    const spawns: Spawn[] = [];
    for (const square of target.squares) {
        const file = path.join(maps, `${square}.jm2`);
        const parts = /^m(\d+)_(\d+)$/.exec(square);
        if (!parts) throw new Error(`cannot read a map square origin out of ${square}`);
        const ox = Number(parts[1]) * 64, oz = Number(parts[2]) * 64;
        let section = false, found = false;
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (line.startsWith('==== ')) {
                section = line.trim() === '==== NPC ====';
                found ||= section;
                continue;
            }
            const row = section ? /^(\d+) (\d+) (\d+): (\d+)\b/.exec(line.trim()) : null;
            if (!row || row[1] !== String(LEVEL)) continue;
            const id = Number(row[4]);
            const adult = id === target.adult.id;
            if (!adult && id !== target.baby?.id) continue;
            spawns.push({ x: ox + Number(row[2]), z: oz + Number(row[3]), size: adult ? target.adult.size : target.baby!.size, adult });
        }
        if (!found) throw new Error(`${file} has no '==== NPC ====' section`);
    }
    if (!spawns.some(s => s.adult)) throw new Error(`no npc ${target.adult.id} spawns in ${target.squares.join(', ')}; check ${maps}`);
    spawns.sort((a, b) => Number(b.adult) - Number(a.adult) || a.x - b.x || a.z - b.z);
    return spawns;
}

export function derive(target = BLUE_DRAGON, packPath = PACK, maps = MAPS): Derivation {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
    const finder = new PathFinder(bytes);

    const walk = (x: number, z: number): boolean => finder.walkable(x, z, LEVEL);
    const exit = (x: number, z: number): number => finder.exitMask(x, z, LEVEL);
    const wall = (x: number, z: number): number => finder.wallMask(x, z, LEVEL);

    /** Whether a size-N body placed with its south-west corner here stands on solid ground. */
    const fits = (ox: number, oz: number, size: number): boolean => {
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                if (!walk(ox + dx, oz + dz)) return false;
            }
        }
        return true;
    };

    // Why: a body only slides when every tile on its leading edge carries the exit flag, so one blocked corner pins the footprint.
    const canSlide = (ox: number, oz: number, size: number, dir: number): boolean => {
        const bit = 1 << dir;
        for (let i = 0; i < size; i++) {
            const x = dir === 1 ? ox + size - 1 : dir === 3 ? ox : ox + i;
            const z = dir === 0 ? oz + size - 1 : dir === 2 ? oz : oz + i;
            if ((exit(x, z) & bit) === 0) return false;
        }
        return true;
    };

    /** Every footprint origin the npc can reach inside `maxrange`, then the tiles it covers and the tiles it can hit from them. */
    const wander = (spawn: Spawn): Wander => {
        const reach = spawn.adult ? target.maxrange : (target.baby?.maxrange ?? target.maxrange);
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
                if (seen.has(key(nx, nz)) || cheb(nx, nz, spawn.x, spawn.z) > reach) continue;
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
    };

    const openX = (x: number, z: number, step: number): boolean =>
        (wall(x, z) & (step > 0 ? WALL_E : WALL_W)) === 0
        && (wall(x + step, z) & (step > 0 ? WALL_W : WALL_E)) === 0
        && walk(x + step, z);

    const openZ = (x: number, z: number, step: number): boolean =>
        (wall(x, z) & (step > 0 ? WALL_N : WALL_S)) === 0
        && (wall(x, z + step) & (step > 0 ? WALL_S : WALL_N)) === 0
        && walk(x, z + step);

    // Why: the engine casts the ray along the longer axis and only shifts the short axis when the scaled fraction rolls over, so a diagonal that looks clear can still enter a rock tile.
    const sees = (x0: number, z0: number, x1: number, z1: number): boolean => {
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
    };

    const spawns = readSpawns(target, maps);
    const wanders = spawns.map(wander);
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

    const flood = (from: { x: number; z: number }, what: string): Set<string> => {
        if (!walk(from.x, from.z)) {
            throw new Error(`${what} (${from.x}, ${from.z}) is not walkable in ${packPath}`);
        }
        const seen = new Set<string>([key(from.x, from.z)]);
        const stack = [from];
        while (stack.length > 0) {
            const t = stack.pop()!;
            const mask = exit(t.x, t.z);
            for (let dir = 0; dir < 8; dir++) {
                if ((mask & (1 << dir)) === 0) continue;
                const nx = t.x + DX[dir]!, nz = t.z + DZ[dir]!;
                if (seen.has(key(nx, nz))) continue;
                seen.add(key(nx, nz));
                stack.push({ x: nx, z: nz });
            }
        }
        return seen;
    };
    const reachable = flood(target.inside, "the gate's inside tile");
    const outside = flood(target.outside, 'the ladder-side tile');
    if (outside.has(key(target.inside.x, target.inside.z))) {
        throw new Error(`the gate at (${target.inside.x}, ${target.inside.z}) is open in ${packPath}, so the two sides of it cannot be told apart`);
    }
    const safespots: Safespot[] = [];
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

    const anchors: Anchor[] = [];
    for (const k of reachable) {
        if (allBody.has(k) || babyThreat.has(k)) continue;
        const [x, z] = parse(k);
        let touchedSpawns = 0, tiles = 0;
        for (const w of adults) {
            let touched = 0;
            for (const b of w.body) {
                const [bx, bz] = parse(b);
                if (cheb(x, z, bx, bz) === 1) touched++;
            }
            if (touched > 0) touchedSpawns++;
            tiles += touched;
        }
        if (touchedSpawns > 0) anchors.push({ x, z, spawns: touchedSpawns, tiles });
    }
    anchors.sort((a, b) => b.spawns - a.spawns || b.tiles - a.tiles || a.x - b.x || a.z - b.z);
    const anchor = anchors[0];
    if (!anchor) {
        throw new Error('no melee anchor survives: every tile bordering an adult is a body tile or inside a baby\'s reach');
    }
    const flanking = safespots.filter(s => cheb(s.x, s.z, anchor.x, anchor.z) <= 2);
    if (flanking.length === 0) {
        throw new Error(`no safespot within 2 of the anchor (${anchor.x}, ${anchor.z})`);
    }
    return { spawns, wanders, bodies: allBody.size, adultBodies: adultBody.size, reachable, outside, safespots, anchors, anchor, flanking };
}

if (import.meta.main) {
    const name = argVal('--target') ?? 'blue';
    const target = TARGETS[name];
    if (!target) throw new Error(`--target takes ${Object.keys(TARGETS).join(', ')}, got '${name}'`);
    const d = derive(target);
    for (const w of d.wanders) {
        console.log(`${w.spawn.adult ? 'adult' : 'baby '} spawn (${w.spawn.x}, ${w.spawn.z}) size ${w.spawn.size}: ${w.placements} placements, ${w.body.size} body tiles, ${w.threat.size} tiles it can hit`);
    }
    console.log(`bodies ${d.bodies} (${d.adultBodies} adult)`);
    console.log(`${d.reachable.size} tiles reachable from the gate's inside tile (${target.inside.x}, ${target.inside.z}), ${d.outside.size} on the ladder side`);
    console.log(`${d.safespots.length} safespots: reachable, off every body, out of every threat set, and looking at an adult inside ${CAST_RANGE}`);
    for (const s of d.safespots.slice(0, 12)) console.log(`  (${s.x}, ${s.z})  sees an adult ${s.range} away`);
    const adultSpawns = d.spawns.filter(s => s.adult).length;
    console.log(`${d.anchors.length} melee anchors: off every body, out of every baby's reach, touching an adult at range 1`);
    for (const a of d.anchors) console.log(`  (${a.x}, ${a.z})  ${a.spawns} of ${adultSpawns} adult spawns, ${a.tiles} body tiles at range 1`);
    console.log(`melee anchor (${d.anchor.x}, ${d.anchor.z})`);
    console.log(`safespots within 2 of it: ${d.flanking.map(s => `(${s.x}, ${s.z})`).join(' ')}`);
}
