/**
 * Which seam joins which pocket of the caverns, and what a route between two of them would be.  Why: the level-1 platforms were solved offline because a runtime search over twenty identical bridges  wandered. Both caverns have the same shape and the same failure. The first cavern's two links are baked  in `CAVERN_LINKS` and end that wander; the second cavern's chain from the well down to the boulder is  five to seven hops through the slave cages, the spade mud, the ledge and the unicorn tunnel, and is not  baked yet — this is the report it would be built from.  bun tools/nav/upass-cavern-route.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);

/** The seams the first cavern is cut by, with the op the module crosses them on. */
const SEAMS: Record<number, string> = {
    3309: 'Climb-over',      // rockslide
    2275: 'Swing-on',        // rope swing
    2274: 'Swing-on',        // rope swing back
    3235: 'Squeeze-through', // obstacle pipe
    3264: 'Climb-into',      // the well
    3266: 'Pick-lock',       // slave cage
    3268: 'Pick-lock',       // cage, thieving 50
    3238: 'Cross',           // the ledge
    3276: 'Cross',           // stone bridge
    3237: 'Squeeze-through', // pipe, second cavern
    3307: 'Climb-up',        // mud pile
    3218: 'Pass-through',    // unicorn tunnel
    3219: 'Pass-through'     // unicorn tunnel
};

const MAPS = path.join(process.env.HOME ?? '', 'code/rs2b2t-content/maps');
const found: { id: number; tile: NavPoint }[] = [];
for (const name of fs.readdirSync(MAPS)) {
    const m = /^m(3[78])_(15[01])\.jm2$/.exec(name);
    if (!m) {
        continue;
    }
    const mx = Number(m[1]);
    const mz = Number(m[2]);
    let section = '';
    // Why: `GameMap` reads a loc's level as `level - 1` wherever the LEVEL-1 land flag carries LINK_BELOW (0x2), so every ledge and stone bridge in the second cavern is written at level 1 and stands at level 0. Filtering on the file's own level dropped all of them, and the report read as a cavern with no ledges and no bridges in it.
    const linkBelow = new Set<number>();
    const lines = fs.readFileSync(path.join(MAPS, name), 'utf8').split('\n');
    for (const line of lines) {
        if (line.startsWith('====')) {
            section = line.replace(/=/g, '').trim();
            continue;
        }
        if (section !== 'MAP') {
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
    section = '';
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
        const id = Number(rest.trim().split(/\s+/)[0]);
        if (SEAMS[id] === undefined) {
            continue;
        }
        const [lvl, lx, lz] = head.trim().split(/\s+/).map(Number);
        const level = linkBelow.has((lx! << 8) | lz!) ? lvl! - 1 : lvl!;
        if (level !== 0) {
            continue;
        }
        found.push({ id, tile: { x: mx * 64 + lx!, z: mz * 64 + lz!, level: 0 } });
    }
}

function pocketId(seed: NavPoint): string | null {
    const seen = new Set<number>();
    const stack = [seed];
    let smallest = Number.MAX_SAFE_INTEGER;
    while (stack.length > 0 && seen.size < 9000) {
        const t = stack.pop()!;
        const key = (t.x << 16) | t.z;
        if (seen.has(key)) {
            continue;
        }
        const probe = finder.findPath(seed, t, { policy: { useTeleports: false }, maxExpansions: 30_000 } as never);
        const last = probe.ok ? probe.waypoints[probe.waypoints.length - 1] : undefined;
        if (!probe.ok || !last || last.x !== t.x || last.z !== t.z) {
            continue;
        }
        seen.add(key);
        smallest = Math.min(smallest, key);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            stack.push({ x: t.x + dx!, z: t.z + dz!, level: 0 });
        }
    }
    return seen.size === 0 ? null : smallest.toString(16);
}

const cache = new Map<number, string | null>();
const idOf = (t: NavPoint): string | null => {
    const key = (t.x << 16) | t.z;
    if (!cache.has(key)) {
        cache.set(key, pocketId(t));
    }
    return cache.get(key)!;
};

const WAYPOINTS: [string, NavPoint][] = [
    ['bridge west', { x: 2442, z: 9716, level: 0 }],
    ['grid approach', { x: 2479, z: 9679, level: 0 }],
    ['orb corridor', { x: 2422, z: 9671, level: 0 }],
    ['well bottom', { x: 2424, z: 9660, level: 0 }],
    ['loose railing', { x: 2397, z: 9606, level: 0 }],
    ['boulder', { x: 2398, z: 9596, level: 0 }],
    ['unicorn cage', { x: 2375, z: 9604, level: 0 }],
    ['second landing', { x: 2440, z: 9650, level: 0 }],
    ['last out', { x: 2438, z: 9607, level: 0 }]
];

console.log('waypoint pockets:');
for (const [name, tile] of WAYPOINTS) {
    console.log(`  ${name.padEnd(18)} ${idOf(tile) ?? 'BLOCKED'}`);
}

console.log(`\n${found.length} seam loc(s) across both caverns`);
for (const { id, tile } of found) {
    const sides: { tile: NavPoint; pocket: string }[] = [];
    const ring: [number, number][] = [];
    for (let d = 1; d <= 3; d++) {
        ring.push([d, 0], [-d, 0], [0, d], [0, -d]);
    }
    for (const [dx, dz] of ring) {
        const at = { x: tile.x + dx!, z: tile.z + dz!, level: 0 };
        const pocket = idOf(at);
        if (pocket !== null && !sides.some(s => s.pocket === pocket)) {
            sides.push({ tile: at, pocket });
        }
    }
    const names = sides.map(s => `${s.pocket}@${s.tile.x},${s.tile.z}`).join(' | ');
    console.log(`  ${SEAMS[id]} ${id} at (${tile.x},${tile.z}) joins ${sides.length}: ${names}`);
}
