/**
 * Derive the Underground Pass as areas and the one action each takes.  Why: the pass is not a search  problem. Every crossing in it is a scripted obstacle with a fixed stand and a fixed landing, read off  the map's own angles and the script's own arithmetic — so which pocket the character is in decides  what to do next, and nothing about distance or gain enters into it. This floods the collision pack,  names every pocket the pass is cut into, and emits the seam that joins each pair with the tile the op  is sent from.  bun tools/nav/upass-areas.ts [--stage 3]
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';

const args = process.argv.slice(2);
const stage = Number(args[args.indexOf('--stage') + 1] ?? 3);

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
const T = (x: number, z: number): NavPoint => ({ x, z, level: 0 });

function routes(from: NavPoint, to: NavPoint): boolean {
    const p = finder.findPath(from, to, { policy: { useTeleports: false }, maxExpansions: 60_000 } as never);
    const last = p.ok ? p.waypoints[p.waypoints.length - 1] : undefined;
    return p.ok && !!last && last.x === to.x && last.z === to.z;
}
const walkable = (t: NavPoint): boolean => routes(t, t);

/** One crossing: stand on `stand`, send `op` at `loc`, arrive at `lands`. */
interface Seam {
    id: number;
    op: string;
    at: NavPoint;
    stand: NavPoint;
    lands: NavPoint;
}

const OPS: Record<number, string> = {
    3309: 'Climb-over', 3276: 'Cross', 3238: 'Cross', 3235: 'Squeeze-through', 3237: 'Squeeze-through',
    3254: 'Cross', 3255: 'Cross', 3266: 'Pick-lock', 3268: 'Pick-lock', 3218: 'Pass-through',
    3219: 'Pass-through', 2274: 'Swing-on', 2275: 'use rope', 2276: 'use rope', 3216: 'use spade',
    3264: 'Climb-into', 3307: 'Climb-up'
};

/** Every crossing a loc offers, from the script that runs it. */
function seamsOf(id: number, at: NavPoint, angle: number): Seam[] {
    const op = OPS[id] ?? '?';
    const mk = (stand: NavPoint, lands: NavPoint): Seam => ({ id, op, at, stand, lands });

    // @rockslide_obstacle and @upass_cross_bridge both branch on z first, then x, and step one tile past.
    if (id === 3309 || id === 3276) {
        return [
            mk(T(at.x, at.z + 1), T(at.x, at.z - 1)), mk(T(at.x, at.z - 1), T(at.x, at.z + 1)),
            mk(T(at.x + 1, at.z), T(at.x - 1, at.z)), mk(T(at.x - 1, at.z), T(at.x + 1, at.z))
        ];
    }
    // ~open_and_close_door2 moves the player across the door's own edge: its tile, or the tile beyond it.
    if (id === 3266 || id === 3268) {
        const off: Record<number, [number, number]> = { 0: [-1, 0], 1: [0, 1], 2: [1, 0], 3: [0, -1] };
        const [dx, dz] = off[angle] ?? [0, 0];
        const across = T(at.x + dx, at.z + dz);
        return [mk(at, across), mk(across, at)];
    }
    // [oploc1,upass_ledge] refuses every tile west of the column and ends at a fixed coord.
    if (id === 3238) {
        return [mk(T(at.x + 1, at.z), T(2374, 9638)), mk(T(at.x + 1, at.z), T(2374, 9643))];
    }
    // [oploc1,upass_pipe6]: mod by the loc's own x, three tiles, a stage-dependent telejump, three more.
    if (id === 3237) {
        const mod = at.x < 2415 ? 1 : -1;
        const start = at.x < 2415 ? T(at.x - 1, at.z) : T(at.x + 2, at.z);
        const jump = stage >= 4 ? 26 : 1;
        return [mk(start, T(start.x + mod * (3 + jump + 3), start.z))];
    }
    // [oploc1,upass_pipe4] crawls three tiles north from where it is used.
    if (id === 3235) {
        return [mk(T(at.x, at.z - 1), T(at.x, at.z + 3))];
    }
    // @upass_rock_ropeswing forcemoves to a fixed start and swings four east.
    if (id === 2275 || id === 2276) {
        return [mk(T(2462, 9699), T(2466, 9699))];
    }
    // [oploc1,loc_2274] walks to loc+4 and swings five west.
    if (id === 2274) {
        return [mk(T(at.x + 4, at.z), T(at.x - 1, at.z))];
    }
    // [oplocu,upass_mud] ends in p_teleport(0_37_150_24_46).
    if (id === 3216) {
        return [mk(T(at.x, at.z + 1), T(2392, 9646))];
    }
    return [];
}

const MAPS = path.join(process.env.HOME ?? '', 'code/rs2b2t-content/maps');
const locs: { id: number; at: NavPoint; angle: number }[] = [];
for (const name of fs.readdirSync(MAPS)) {
    const m = /^m(3[6-9])_(15[0-3])\.jm2$/.exec(name);
    if (!m) {
        continue;
    }
    const mx = Number(m[1]);
    const mz = Number(m[2]);
    // Why: `GameMap` reads a loc's level as `level - 1` wherever the LEVEL-1 land flag carries LINK_BELOW (0x2), so every ledge and stone bridge in the pass is written at level 1 and stands at level 0. Filtering on the file's own level drops all of them, and the graph reads as a cavern with no ledges in it.
    const lines = fs.readFileSync(path.join(MAPS, name), 'utf8').split('\n');
    const linkBelow = new Set<number>();
    let land = '';
    for (const line of lines) {
        if (line.startsWith('====')) {
            land = line.replace(/=/g, '').trim();
            continue;
        }
        if (land !== 'MAP') {
            continue;
        }
        const [head, rest] = line.split(':');
        if (!head || !rest) {
            continue;
        }
        const [lvl, lx, lz] = head.trim().split(/\s+/).map(Number);
        if (lvl !== 1) {
            continue;
        }
        const flag = rest.trim().split(/\s+/).find(token => /^f\d+$/.test(token));
        if (flag !== undefined && (Number(flag.slice(1)) & 0x2) === 0x2) {
            linkBelow.add((lx! << 8) | lz!);
        }
    }
    let section = '';
    for (const line of lines) {
        if (line.startsWith('====')) {
            section = line.replace(/=/g, '').trim();
            continue;
        }
        if (section !== 'LOC') {
            continue;
        }
        const [head, rest] = line.split(':');
        if (!head || !rest) {
            continue;
        }
        const parts = rest.trim().split(/\s+/).map(Number);
        const id = parts[0]!;
        if (OPS[id] === undefined) {
            continue;
        }
        const [lvl, lx, lz] = head.trim().split(/\s+/).map(Number);
        const level = linkBelow.has((lx! << 8) | lz!) ? lvl! - 1 : lvl!;
        if (level !== 0) {
            continue;
        }
        locs.push({ id, at: T(mx * 64 + lx!, mz * 64 + lz!), angle: parts[2] ?? 0 });
    }
}

// Why: an area's name has to survive a re-derivation, so it is the smallest packed tile in the pocket rather than the order the flood happened to meet it. The anchor is the tile the runtime routes to, to ask "am I here".
const anchors: NavPoint[] = [];
const names: string[] = [];
function canonical(seed: NavPoint): string {
    const seen = new Set<number>();
    const stack = [seed];
    let smallest = Number.MAX_SAFE_INTEGER;
    while (stack.length > 0 && seen.size < 3000) {
        const t = stack.pop()!;
        const key = (t.x << 16) | t.z;
        if (seen.has(key) || !routes(seed, t)) {
            continue;
        }
        seen.add(key);
        smallest = Math.min(smallest, key);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            stack.push({ x: t.x + dx!, z: t.z + dz!, level: 0 });
        }
    }
    return smallest.toString(16);
}
const areaOf = (t: NavPoint): string | null => {
    if (!walkable(t)) {
        return null;
    }
    for (let i = 0; i < anchors.length; i++) {
        if (routes(anchors[i]!, t)) {
            return names[i]!;
        }
    }
    anchors.push(t);
    names.push(canonical(t));
    return names[names.length - 1]!;
};

const edges: { from: string; to: string; seam: Seam }[] = [];
for (const loc of locs.sort((a, b) => a.at.z - b.at.z || a.at.x - b.at.x)) {
    for (const seam of seamsOf(loc.id, loc.at, loc.angle)) {
        const from = areaOf(seam.stand);
        const to = areaOf(seam.lands);
        if (from === null || to === null || from === to) {
            continue;
        }
        edges.push({ from, to, seam });
    }
}

console.log(`areas: ${anchors.length}, crossings: ${edges.length}\n`);
for (const e of edges) {
    console.log(`  ${e.from.padEnd(4)} -> ${e.to.padEnd(4)}  ${e.seam.op} ${e.seam.id}@(${e.seam.at.x},${e.seam.at.z})`
        + `  stand (${e.seam.stand.x},${e.seam.stand.z}) lands (${e.seam.lands.x},${e.seam.lands.z})`);
}

const LANDMARKS: [string, NavPoint][] = [
    ['cave exit', T(2495, 9716)], ['Koftik bridge', T(2449, 9716)], ['bridge west', T(2442, 9716)],
    ['rockswing east', T(2466, 9699)], ['grid approach', T(2479, 9679)], ['well landing', T(2425, 9658)],
    ['mud cage stand', T(2393, 9655)], ['mud cell', T(2393, 9651)], ['mud dig lands', T(2392, 9646)],
    ['ledge stand', T(2375, 9644)], ['ledge lands', T(2374, 9638)], ['loose railings', T(2397, 9606)],
    ['unicorn cage', T(2375, 9604)], ['boulder', T(2398, 9596)]
];
console.log('\nlandmarks:');
for (const [name, t] of LANDMARKS) {
    console.log(`  ${name.padEnd(18)} (${t.x},${t.z})  ${areaOf(t) ?? 'BLOCKED'}`);
}

// Why: the route is what a breadth-first walk of that graph says, not what a runtime search guesses.
function chain(from: NavPoint, to: NavPoint): string {
    const start = areaOf(from);
    const goal = areaOf(to);
    if (start === null || goal === null) {
        return 'BLOCKED';
    }
    const seen = new Set([start]);
    let frontier: { area: string; path: string[] }[] = [{ area: start, path: [] }];
    while (frontier.length > 0) {
        const hit = frontier.find(f => f.area === goal);
        if (hit) {
            return hit.path.length === 0 ? 'same area, walk it' : hit.path.join(' → ');
        }
        const next: { area: string; path: string[] }[] = [];
        for (const f of frontier) {
            for (const e of edges) {
                if (e.from === f.area && !seen.has(e.to)) {
                    seen.add(e.to);
                    next.push({ area: e.to, path: [...f.path, `${e.seam.op} ${e.seam.id}@(${e.seam.at.x},${e.seam.at.z}) from (${e.seam.stand.x},${e.seam.stand.z})`] });
                }
            }
        }
        frontier = next;
    }
    return 'NO CHAIN';
}

console.log(`\nlegs (stage ${stage}):`);
for (let i = 0; i + 1 < LANDMARKS.length; i++) {
    const [an, a] = LANDMARKS[i]!;
    const [bn, b] = LANDMARKS[i + 1]!;
    console.log(`  ${an} → ${bn}:\n    ${chain(a, b)}`);
}

// Why: the table the runtime reads, emitted rather than hand-copied — every tile in it came from the map and the script, and a re-derivation after a content change rewrites it.
if (args.includes('--emit')) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (let i = 0; i < anchors.length; i++) {
        if (edges.some(e => e.from === names[i] || e.to === names[i])) {
            lines.push(`    { area: '${names[i]}', anchor: new Tile(${anchors[i]!.x}, ${anchors[i]!.z}, 0) }`);
        }
    }
    console.log('\n// ---- emit ----');
    console.log('export const UPASS_AREAS: readonly UpassArea[] = [');
    console.log(lines.join(',\n'));
    console.log('];\n');
    console.log('export const UPASS_CROSSINGS: readonly UpassCrossing[] = [');
    const rows: string[] = [];
    for (const e of edges) {
        const key = `${e.from}>${e.to}>${e.seam.id}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        rows.push(`    { from: '${e.from}', to: '${e.to}', loc: ${e.seam.id}, op: '${e.seam.op}',`
            + ` stand: new Tile(${e.seam.stand.x}, ${e.seam.stand.z}, 0),`
            + ` lands: new Tile(${e.seam.lands.x}, ${e.seam.lands.z}, 0) }`);
    }
    console.log(rows.join(',\n'));
    console.log('];');
}
