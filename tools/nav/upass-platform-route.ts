/**
 * Which collapsed bridges join which level-1 platforms, and the chain between two of them.  Why: the platforms are a graph of pockets joined by twenty identical bridges, and a runtime search over  it wanders — four crossings in thirty-five minutes, none of them toward the target. The graph is static,  so it is solved here once and the answer is baked into the module.  bun tools/nav/upass-platform-route.ts
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

const MAPS = path.join(process.env.HOME ?? '', 'code/rs2b2t-content/maps');
const bridges: NavPoint[] = [];
for (const name of fs.readdirSync(MAPS)) {
    const m = /^m(3[23])_(7[0-5])\.jm2$/.exec(name);
    if (!m) {
        continue;
    }
    const mx = Number(m[1]);
    const mz = Number(m[2]);
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
        if (id !== 3254 && id !== 3255) {
            continue;
        }
        const [lvl, lx, lz] = head.trim().split(/\s+/).map(Number);
        bridges.push({ x: mx * 64 + lx!, z: mz * 64 + lz!, level: lvl! });
    }
}

/** A pocket's identity: the smallest packed tile it contains. */
function pocketId(seed: NavPoint): number | null {
    const seen = new Set<number>();
    const stack = [seed];
    let smallest = Number.MAX_SAFE_INTEGER;
    while (stack.length > 0 && seen.size < 8000) {
        const t = stack.pop()!;
        const key = (t.x << 16) | t.z;
        if (seen.has(key)) {
            continue;
        }
        const probe = finder.findPath(seed, t, { policy: { useTeleports: false }, maxExpansions: 20_000 } as never);
        const last = probe.ok ? probe.waypoints[probe.waypoints.length - 1] : undefined;
        if (!probe.ok || !last || last.x !== t.x || last.z !== t.z) {
            continue;
        }
        seen.add(key);
        smallest = Math.min(smallest, key);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            stack.push({ x: t.x + dx!, z: t.z + dz!, level: seed.level });
        }
    }
    return seen.size === 0 ? null : smallest;
}

const cache = new Map<number, number | null>();
const idOf = (t: NavPoint): number | null => {
    const key = (t.x << 16) | t.z;
    if (!cache.has(key)) {
        cache.set(key, pocketId(t));
    }
    return cache.get(key)!;
};

console.log(`${bridges.length} bridges on the platforms`);
const edges: { bridge: NavPoint; sides: { tile: NavPoint; pocket: number }[] }[] = [];
for (const b of bridges) {
    // Why: these bridges span a chasm — the far landing is three or four tiles out, not adjacent — so a
    // cardinal-neighbour probe only ever finds the near side and every bridge reads as joining one pocket.
    const sides: { tile: NavPoint; pocket: number }[] = [];
    const ring: [number, number][] = [];
    for (let d = 1; d <= 4; d++) {
        ring.push([d, 0], [-d, 0], [0, d], [0, -d]);
    }
    for (const [dx, dz] of ring) {
        const tile = { x: b.x + dx!, z: b.z + dz!, level: b.level };
        const id = idOf(tile);
        if (id !== null && !sides.some(s => s.pocket === id)) {
            sides.push({ tile, pocket: id });
        }
    }
    edges.push({ bridge: b, sides });
    const names = sides.map(s => `${s.pocket.toString(16)}@${s.tile.x},${s.tile.z}`).join(' | ');
    console.log(`  bridge (${b.x},${b.z}) joins ${sides.length}: ${names}`);
}

const LANDMARKS: [string, NavPoint][] = [
    ['main landing', { x: 2173, z: 4725, level: 1 }],
    ['soulless cages', { x: 2134, z: 4703, level: 1 }],
    ["witch's cat", { x: 2131, z: 4603, level: 1 }],
    ['witch door', { x: 2158, z: 4567, level: 1 }],
    ['sealed chest', { x: 2136, z: 4579, level: 1 }],
    ["Iban's doors", { x: 2145, z: 4647, level: 1 }]
];

console.log('\nlandmark pockets:');
for (const [name, tile] of LANDMARKS) {
    const id = idOf(tile);
    console.log(`  ${name.padEnd(16)} ${id === null ? 'NOT WALKABLE' : id.toString(16)}`);
}

// Why: emitted as source, because hand-copying twenty-two coordinate triples is how a map gets a typo in it.
console.log('\n// paste into areas.ts');
console.log('export const PLATFORM_LINKS: readonly PlatformLink[] = [');
for (const { bridge, sides } of edges) {
    if (sides.length !== 2) {
        continue;
    }
    const [a, b] = sides;
    console.log(
        `    { bridge: new Tile(${bridge.x}, ${bridge.z}, 1),`
        + ` a: { tile: new Tile(${a!.tile.x}, ${a!.tile.z}, 1), pocket: '${a!.pocket.toString(16)}' },`
        + ` b: { tile: new Tile(${b!.tile.x}, ${b!.tile.z}, 1), pocket: '${b!.pocket.toString(16)}' } },`
    );
}
console.log('];');
