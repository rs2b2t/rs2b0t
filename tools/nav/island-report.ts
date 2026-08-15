/** Map-wide connectivity census: every region the walker cannot reach from the mainland, and the loc most likely to be the missing edge. Default islands >= 40 tiles; --min 200 --top 30 --json out/islands.json.
 *  Why: flooding uses the pack's exit masks plus the baked door / transport / stair edges, i.e. what A* can traverse — plain walkability over-connects and lies. */

// Why: a clue, quest step or bot that "can't get there" is usually not a walker bug — it is a region the baked graph never joined up.

//   bun tools/nav/island-report.ts                    # islands >= 40 tiles
//   bun tools/nav/island-report.ts --min 200 --top 30
//   bun tools/nav/island-report.ts --json out/islands.json
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/event/webwalk/data/doors.json';
import transportsJson from '#/bot/event/webwalk/data/transports.json';
import stairsJson from '#/bot/event/webwalk/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];

const args = process.argv.slice(2);
const arg = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : fallback;
};
const MIN_TILES = Number(arg('min', '40'));
const TOP = Number(arg('top', '40'));
const JSON_OUT = args.includes('--json') ? arg('json', 'out/islands.json') : null;
const PACK = arg('pack', 'out/collision.lcnav.gz');
const ENGINE = arg('engine', join(homedir(), 'code', 'lostcity-dev', 'engine'));
// Why: ops that move a player between regions outrank ops that merely clear scenery (cutting jungle, slashing a web) — either can be the crossing, but a door is a likelier answer than the nearest tree.
const MOVEMENT_OP = /^(open|climb|enter|exit|pass|pay|cross|go|push|pull|squeeze|walk|jump|swing|board|travel|ride|balance|use)/i;
const CLEARING_OP = /^(slash|chop|cut|mine)/i;
const CROSSING_OP = new RegExp(`${MOVEMENT_OP.source}|${CLEARING_OP.source}`, 'i');
const SEAM_RANGE = 6;

const key = (x: number, z: number, level: number): number => (level << 28) | (x << 14) | z;
const kx = (k: number): number => (k >> 14) & 0x3fff;
const kz = (k: number): number => k & 0x3fff;
const klevel = (k: number): number => (k >>> 28) & 0x3;

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as TransportEdgeData[], stairsJson as TransportEdgeData[]);

interface LocAt {
    x: number;
    z: number;
    level: number;
    name: string;
    debugname: string;
    ops: string[];
}

function loadCrossingLocs(): Map<number, LocAt[]> {
    const { configs } = loadLocTypes(ENGINE);
    const byTile = new Map<number, LocAt[]>();
    for (const { mx, mz, land, loc } of loadMapsquares(ENGINE)) {
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));
        forEachLoc(new Reader(loc), instance => {
            const type = configs[instance.locId];
            const ops = (type?.op ?? []).filter((op): op is string => op != null);
            if (!ops.some(op => CROSSING_OP.test(op))) {
                return;
            }
            const level = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
            if (level < 0) {
                return;
            }
            const at: LocAt = {
                x: baseX + instance.x,
                z: baseZ + instance.z,
                level,
                name: type.name ?? type.debugname ?? `loc_${instance.locId}`,
                debugname: type.debugname ?? `loc_${instance.locId}`,
                ops
            };
            const k = key(at.x, at.z, at.level);
            byTile.set(k, [...(byTile.get(k) ?? []), at]);
        });
    }
    return byTile;
}

/** Label every walkable tile with its component id. */
function labelComponents(): { label: Map<number, number>; members: number[][] } {
    const walkable: number[] = [];
    for (const { mx, mz, level } of finder.populatedSquares()) {
        const baseX = mx << 6;
        const baseZ = mz << 6;
        for (let lx = 0; lx < 64; lx++) {
            for (let lz = 0; lz < 64; lz++) {
                if (finder.walkable(baseX + lx, baseZ + lz, level)) {
                    walkable.push(key(baseX + lx, baseZ + lz, level));
                }
            }
        }
    }

    const label = new Map<number, number>();
    const members: number[][] = [];
    for (const seed of walkable) {
        if (label.has(seed)) {
            continue;
        }
        const id = members.length;
        const group: number[] = [];
        const stack = [seed];
        label.set(seed, id);
        while (stack.length > 0) {
            const cur = stack.pop()!;
            group.push(cur);
            const x = kx(cur);
            const z = kz(cur);
            const level = klevel(cur);

            const exits = finder.exitMask(x, z, level);
            for (let d = 0; d < 8; d++) {
                if ((exits & (1 << d)) === 0) {
                    continue;
                }
                const nx = x + DX[d];
                const nz = z + DZ[d];
                if (!finder.walkable(nx, nz, level)) {
                    continue;
                }
                const nk = key(nx, nz, level);
                if (!label.has(nk)) {
                    label.set(nk, id);
                    stack.push(nk);
                }
            }

            for (const hop of finder.edgesFrom(x, z, level)) {
                if (!finder.walkable(hop.x, hop.z, hop.level)) {
                    continue;
                }
                const nk = key(hop.x, hop.z, hop.level);
                if (!label.has(nk)) {
                    label.set(nk, id);
                    stack.push(nk);
                }
            }
        }
        members.push(group);
    }
    return { label, members };
}

console.log(`pack ${PACK}: ${finder.mapsquares} mapsquares, members=${finder.members}`);
const { label, members } = labelComponents();
const mainland = members.reduce((best, g, i) => (g.length > members[best].length ? i : best), 0);
const total = members.reduce((n, g) => n + g.length, 0);
console.log(
    `${total} walkable tiles in ${members.length} components; mainland is #${mainland} with ${members[mainland].length}`
    + ` (${((members[mainland].length / total) * 100).toFixed(1)}%)`
);

const crossings = loadCrossingLocs();

interface Island {
    tiles: number;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    level: number;
    /** Locs sitting between this island and the mainland — the likely fix. */
    seams: { name: string; debugname: string; ops: string[]; x: number; z: number; level: number; near: string }[];
}

const islands: Island[] = [];
for (let id = 0; id < members.length; id++) {
    if (id === mainland || members[id].length < MIN_TILES) {
        continue;
    }
    const group = members[id];
    const xs = group.map(kx);
    const zs = group.map(kz);
    const seams = new Map<string, Island['seams'][number]>();

    for (const k of group) {
        const x = kx(k);
        const z = kz(k);
        const level = klevel(k);
        // Only look for seams where the mainland is close by.
        let touchesMainland = false;
        for (let dx = -SEAM_RANGE; dx <= SEAM_RANGE && !touchesMainland; dx++) {
            for (let dz = -SEAM_RANGE; dz <= SEAM_RANGE; dz++) {
                if (label.get(key(x + dx, z + dz, level)) === mainland) {
                    touchesMainland = true;
                    break;
                }
            }
        }
        if (!touchesMainland) {
            continue;
        }
        for (let dx = -2; dx <= 2; dx++) {
            for (let dz = -2; dz <= 2; dz++) {
                for (const at of crossings.get(key(x + dx, z + dz, level)) ?? []) {
                    const id2 = `${at.debugname}@${at.x},${at.z},${at.level}`;
                    if (!seams.has(id2)) {
                        seams.set(id2, { ...at, near: `${x},${z},${level}` });
                    }
                }
            }
        }
    }

    const ranked = [...seams.values()].sort((a, b) => {
        const rank = (s: typeof a): number => (s.ops.some(op => MOVEMENT_OP.test(op)) ? 0 : 1);
        return rank(a) - rank(b);
    });
    seams.clear();
    for (const s of ranked) {
        seams.set(`${s.debugname}@${s.x},${s.z},${s.level}`, s);
    }

    islands.push({
        tiles: group.length,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
        level: klevel(group[0]),
        seams: [...seams.values()]
    });
}

islands.sort((a, b) => b.tiles - a.tiles);
console.log(`\n${islands.length} islands >= ${MIN_TILES} tiles (${islands.reduce((n, i) => n + i.tiles, 0)} tiles marooned)\n`);

for (const island of islands.slice(0, TOP)) {
    console.log(
        `${String(island.tiles).padStart(6)} tiles  x ${island.minX}..${island.maxX}  z ${island.minZ}..${island.maxZ}  level ${island.level}`
        + `${island.seams.length === 0 ? '  — no crossing loc near the mainland' : ''}`
    );
    for (const s of island.seams.slice(0, 5)) {
        console.log(`         ${s.name} [${s.ops.join('/')}] ${s.debugname} @ (${s.x},${s.z},${s.level})`);
    }
    if (island.seams.length > 5) {
        console.log(`         … ${island.seams.length - 5} more crossing locs`);
    }
}

if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(islands, null, 1));
    console.log(`\nwrote ${JSON_OUT}`);
}
