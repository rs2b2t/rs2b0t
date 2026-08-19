/**
 * Offline seam check for the Underground Pass: does every waypoint have a crossing to the next one?  Why: the pass is sealed pockets joined by scripted obstacles, and a leg that lands in a pocket with no  seam it can name costs a three-minute live boot to discover. This floods each waypoint's pocket in the  collision pack, then reports which known seam locs touch that pocket's edge — so a missing crossing is a  minute of reading rather than a run.  bun tools/nav/upass-seams.ts [--maps ~/code/rs2b2t-content/maps] [--pack out/collision.lcnav.gz]
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
    const i = args.indexOf(name);
    return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

const MAPS = flag('--maps', path.join(process.env.HOME ?? '', 'code/rs2b2t-content/maps'));
const PACK = flag('--pack', 'out/collision.lcnav.gz');

/** Loc ids the quest module treats as crossings, and what each is called in the log. */
const SEAMS: Record<number, string> = {
    3309: 'rockslide',
    3276: 'stone bridge',
    3238: 'ledge',
    3235: 'pipe (first cavern)',
    3237: 'pipe (second cavern)',
    3254: 'collapsed bridge',
    3255: 'collapsed bridge',
    2274: 'rope swing back',
    2275: 'rope swing',
    3218: 'unicorn tunnel',
    3219: 'unicorn tunnel',
    3266: 'locked cage',
    3268: 'locked cage (thieving 50)',
    3216: 'mud (spade)',
    3264: 'well',
    3307: 'mud pile',
    3222: 'wall tunnel down',
    3223: 'wall tunnel up'
};

/** The route, in the order the quest walks it. */
const ROUTE: [string, NavPoint][] = [
    ['area 1 landing', { x: 2494, z: 9716, level: 0 }],
    ['bridge west', { x: 2442, z: 9716, level: 0 }],
    ['grid approach', { x: 2479, z: 9679, level: 0 }],
    ['orb corridor', { x: 2454, z: 9682, level: 0 }],
    ['log trap', { x: 2383, z: 9668, level: 0 }],
    ['well', { x: 2415, z: 9674, level: 0 }],
    ['second cavern landing', { x: 2423, z: 9660, level: 0 }],
    ['slave cell', { x: 2394, z: 9652, level: 0 }],
    ['mud exit', { x: 2392, z: 9646, level: 0 }],
    ['ledge south', { x: 2374, z: 9638, level: 0 }],
    ['swamp band', { x: 2394, z: 9620, level: 0 }],
    ['tunnel row', { x: 2400, z: 9612, level: 0 }],
    ['loose railing', { x: 2397, z: 9606, level: 0 }],
    ['unicorn cage', { x: 2375, z: 9604, level: 0 }],
    ['paladins', { x: 2424, z: 9719, level: 0 }],
    ['blood well', { x: 2373, z: 9717, level: 0 }],
    ['past cage 3268 west', { x: 2380, z: 9618, level: 0 }],
    ['east of cage 3268', { x: 2405, z: 9620, level: 0 }],
    ['boulder stand', { x: 2398, z: 9596, level: 0 }],
    ['main cavern landing', { x: 2173, z: 4725, level: 1 }],
    ['soulless cages', { x: 2134, z: 4703, level: 1 }],
    ['tunnel down to dwarves', { x: 2150, z: 4546, level: 1 }],
    ['tunnel down to Kalrag', { x: 2113, z: 4729, level: 1 }],
    ['witch door', { x: 2158, z: 4567, level: 1 }],
    ['witch chest', { x: 2157, z: 4565, level: 1 }],
    ["witch's cat", { x: 2131, z: 4603, level: 1 }],
    ['sealed chest', { x: 2136, z: 4579, level: 1 }],
    ['Doomion', { x: 2134, z: 4566, level: 1 }],
    ['Holthion', { x: 2132, z: 4555, level: 1 }],
    ['Othainian', { x: 2122, z: 4563, level: 1 }],
    ["Iban's doors", { x: 2145, z: 4647, level: 1 }],
    ["Iban's altar", { x: 2137, z: 4647, level: 1 }],
    ['dwarf camp', { x: 2315, z: 9806, level: 0 }],
    ["Iban's tomb", { x: 2357, z: 9801, level: 0 }],
    ['tunnel up from dwarves', { x: 2336, z: 9794, level: 0 }],
    ['Kalrag', { x: 2356, z: 9911, level: 0 }],
    ['tunnel up from Kalrag', { x: 2305, z: 9915, level: 0 }]
];

interface Placed {
    id: number;
    x: number;
    z: number;
    level: number;
}

/** Every loc id in the content pack that carries at least one op, by id, with its debug name and ops. */
function readOpLocs(): Map<number, { name: string; ops: string[] }> {
    const root = path.dirname(MAPS);
    const byName = new Map<string, string[]>();
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
            } else if (entry.name.endsWith('.loc')) {
                let cur = '';
                for (const raw of fs.readFileSync(full, 'utf8').split('\n')) {
                    const line = raw.trim();
                    if (line.startsWith('[') && line.endsWith(']')) {
                        cur = line.slice(1, -1);
                    } else if (cur && /^op\d=/.test(line)) {
                        byName.set(cur, [...(byName.get(cur) ?? []), line.split('=')[1]!]);
                    }
                }
            }
        }
    };
    walk(path.join(root, 'scripts'));
    const out = new Map<number, { name: string; ops: string[] }>();
    for (const line of fs.readFileSync(path.join(root, 'pack/loc.pack'), 'utf8').split('\n')) {
        const [id, name] = line.split('=');
        const ops = name && byName.get(name.trim());
        if (id && name && ops) {
            out.set(Number(id), { name: name.trim(), ops });
        }
    }
    return out;
}

const OP_LOCS = readOpLocs();

function readLocs(keep: (id: number) => boolean): Placed[] {
    const out: Placed[] = [];
    for (const name of fs.readdirSync(MAPS)) {
        const m = /^m(\d+)_(\d+)\.jm2$/.exec(name);
        if (!m) {
            continue;
        }
        const mx = Number(m[1]);
        const mz = Number(m[2]);
        // Why: the pass only occupies these map squares, and reading every square of the world costs a minute.
        if (mx < 33 || mx > 40 || (mz < 149 || mz > 156) && (mz < 70 || mz > 75)) {
            continue;
        }
        let section = '';
        for (const line of fs.readFileSync(path.join(MAPS, name), 'utf8').split('\n')) {
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
            const id = Number(rest.trim().split(/\s+/)[0]);
            if (!keep(id)) {
                continue;
            }
            const [level, lx, lz] = head.trim().split(/\s+/).map(Number);
            out.push({ id, x: mx * 64 + lx!, z: mz * 64 + lz!, level: level! });
        }
    }
    return out;
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
const locs = readLocs(id => SEAMS[id] !== undefined);
const opLocs = readLocs(id => OP_LOCS.has(id));
console.log(`${locs.length} seam loc(s) and ${opLocs.length} op-bearing loc(s) placed across the pass`);

/** Every tile reachable on foot from `seed`, capped so a surface leak cannot run away with the tool. */
function pocket(seed: NavPoint): Set<number> {
    const seen = new Set<number>();
    const stack = [seed];
    while (stack.length > 0 && seen.size < 20_000) {
        const t = stack.pop()!;
        const key = (t.x << 16) | t.z;
        if (seen.has(key)) {
            continue;
        }
        // Why: `findPath` accepts a goal up to five tiles short, so "reachable" from it is not "standable on" — a flood built on it claimed the collapsed bridges bordered the main cavern landing, and they do not. The last waypoint has to be the tile itself.
        const probe = finder.findPath(seed, t, { policy: { useTeleports: false }, maxExpansions: 20_000 } as never);
        const last = probe.ok ? probe.waypoints[probe.waypoints.length - 1] : undefined;
        if (!probe.ok || !last || last.x !== t.x || last.z !== t.z) {
            continue;
        }
        seen.add(key);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            stack.push({ x: t.x + dx!, z: t.z + dz!, level: seed.level });
        }
    }
    return seen;
}

const pockets = ROUTE.map(([name, seed]) => {
    const tiles = pocket(seed);
    return { name, seed, tiles };
});

// Why: two waypoints in one pocket need no crossing at all, and that is the fact a route plan turns on.
const groups = new Map<string, string[]>();
for (const p of pockets) {
    const key = [...p.tiles].sort((a, b) => a - b).slice(0, 4).join(',');
    groups.set(key, [...(groups.get(key) ?? []), p.name]);
}
console.log('\npockets shared by more than one waypoint:');
for (const names of groups.values()) {
    if (names.length > 1) {
        console.log(`  ${names.join(' = ')}`);
    }
}
console.log('');

for (let i = 0; i < pockets.length; i++) {
    const here = pockets[i]!;
    const next = pockets[i + 1];
    // Why: a seam is usable from a pocket when one of its cardinal neighbours is in it — the seam's own tile
    // is blocked, which is what makes it a seam.
    const onEdge = locs.filter(loc => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
        ([dx, dz]) => here.tiles.has(((loc.x + dx!) << 16) | (loc.z + dz!))
    ));
    const named = [...new Set(onEdge.map(loc => `${SEAMS[loc.id]}(${loc.id})`))].join(', ') || 'NONE';
    console.log(`${here.name.padEnd(24)} ${String(here.tiles.size).padStart(5)} tiles — seams: ${named}`);
    // Why: the vocabulary is the likelier gap, so the unnamed ops on a pocket's edge are what a stuck leg
    // needs to see — one of them is the crossing nobody wrote down.
    const unnamed = [...new Set(opLocs
        .filter(loc => SEAMS[loc.id] === undefined)
        .filter(loc => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
            ([dx, dz]) => here.tiles.has(((loc.x + dx!) << 16) | (loc.z + dz!))
        ))
        .map(loc => `${OP_LOCS.get(loc.id)!.name}(${loc.id})[${OP_LOCS.get(loc.id)!.ops.join('|')}]`))];
    if (unnamed.length > 0) {
        console.log(`  other ops on its edge: ${unnamed.slice(0, 10).join(' ')}`);
    }
    if (next && !here.tiles.has((next.seed.x << 16) | next.seed.z) && onEdge.length === 0) {
        console.log(`  ^ NO SEAM out of this pocket, and "${next.name}" is not in it`);
    }
}
