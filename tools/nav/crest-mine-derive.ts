/** Derive the Family Crest gold-mine route from the baked collision pack. defs/familycrest/mine.ts is written against both outputs: the shortest levers-and-doors chain from the ladder landing to the perfect gold, BFS'd over (tile, 3 lever bits), and the four rooms the doors cut the mine into, flooded with the doors removed.
 *  Why: the three levers and four doors interlock — the combination that opens one shuts another — so no walkthrough gives the chain in a form the walker can use; the room z-ranges are disjoint and only the gold room lies east of x=2727, which lets `mineRegion()` name a room from a tile alone. The doors sit in derive-doors.ts SCRIPT_REFUSED, so they are absent from doors.json and the navigator never routes through one. */

//   bun tools/nav/crest-mine-derive.ts
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

let packPath = 'out/collision.lcnav.gz';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pack') {
        packPath = args[++i]!;
    } else {
        console.error(`unknown argument: ${args[i]}`);
        process.exit(2);
    }
}

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);

/** quest_crest.constant: crest_north_room_lever / _north_lever / _south_lever. */
const NR = 1, N = 2, S = 4;

const MINE = { minX: 2688, maxX: 2751, minZ: 9664, maxZ: 9727 };
const GOLD_ZONE = { minX: 2736, maxX: 2740, minZ: 9684, maxZ: 9693 };
const LANDING = { x: 2696, z: 9683 };

interface Door {
    x: number;
    z: number;
    dx: number;
    dz: number;
    label: string;
    open: (bits: number) => boolean;
}

const DOORS: Door[] = [
    { x: 2719, z: 9671, dx: 0, dz: 1, label: 'famcrest_doorh2 (N up, S up)', open: b => !!(b & N) && !!(b & S) },
    { x: 2722, z: 9671, dx: 0, dz: 1, label: 'famcrest_doorg2h1 (N up, S down)', open: b => !!(b & N) && !(b & S) },
    { x: 2723, z: 9711, dx: 0, dz: -1, label: 'famcrest_doorh2g1 (N down, S up)', open: b => !(b & N) && !!(b & S) },
    { x: 2727, z: 9690, dx: 1, dz: 0, label: 'famcrest_doori2h1 (N up, S down, NR up)', open: b => !!(b & N) && !(b & S) && !!(b & NR) }
];

const LEVERS = [
    { x: 2722, z: 9718, bit: NR, name: 'leveri  (north room)' },
    { x: 2722, z: 9710, bit: N, name: 'leverg  (north)' },
    { x: 2724, z: 9669, bit: S, name: 'leverh  (south)' }
];

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];

const inMine = (x: number, z: number): boolean =>
    x >= MINE.minX && x <= MINE.maxX && z >= MINE.minZ && z <= MINE.maxZ;

const key = (x: number, z: number, bits: number): number =>
    ((x - MINE.minX) << 16) | ((z - MINE.minZ) << 4) | bits;

const inGold = (x: number, z: number): boolean =>
    x >= GOLD_ZONE.minX && x <= GOLD_ZONE.maxX && z >= GOLD_ZONE.minZ && z <= GOLD_ZONE.maxZ;

function deriveChain(): string[] {
    const prev = new Map<number, { from: number; how: string }>();
    const start = key(LANDING.x, LANDING.z, 0);
    const seen = new Set<number>([start]);
    const queue: { x: number; z: number; bits: number }[] = [{ ...LANDING, bits: 0 }];
    let goal: number | null = null;

    while (queue.length > 0 && goal === null) {
        const cur = queue.shift()!;
        const from = key(cur.x, cur.z, cur.bits);
        const push = (x: number, z: number, bits: number, how: string): void => {
            const k = key(x, z, bits);
            if (seen.has(k)) {
                return;
            }
            seen.add(k);
            prev.set(k, { from, how });
            if (inGold(x, z)) {
                goal = k;
            }
            queue.push({ x, z, bits });
        };

        const mask = finder.exitMask(cur.x, cur.z, 0);
        for (let d = 0; d < 8; d++) {
            if ((mask & (1 << d)) === 0) {
                continue;
            }
            const nx = cur.x + DX[d]!, nz = cur.z + DZ[d]!;
            if (inMine(nx, nz)) {
                push(nx, nz, cur.bits, `walk ${nx},${nz}`);
            }
        }
        for (const door of DOORS) {
            if (!door.open(cur.bits)) {
                continue;
            }
            const far = { x: door.x + door.dx, z: door.z + door.dz };
            if (cur.x === door.x && cur.z === door.z) {
                push(far.x, far.z, cur.bits, `OPEN ${door.label} → ${far.x},${far.z}`);
            }
            if (cur.x === far.x && cur.z === far.z) {
                push(door.x, door.z, cur.bits, `OPEN ${door.label} → ${door.x},${door.z}`);
            }
        }
        for (const lever of LEVERS) {
            if (Math.max(Math.abs(cur.x - lever.x), Math.abs(cur.z - lever.z)) > 1) {
                continue;
            }
            const bits = cur.bits ^ lever.bit;
            push(cur.x, cur.z, bits, `PULL ${lever.name} → ${(bits & lever.bit) ? 'UP' : 'DOWN'}`);
        }
    }

    if (goal === null) {
        return [];
    }
    const moves: string[] = [];
    for (let k: number | undefined = goal; k !== undefined && k !== start;) {
        const step: { from: number; how: string } | undefined = prev.get(k);
        if (!step) {
            break;
        }
        moves.push(step.how);
        k = step.from;
    }
    return moves.reverse();
}

function floodRooms(): void {
    const seeds: [string, number, number][] = [
        ['main   (landing, north lever, west sides of every door)', LANDING.x, LANDING.z],
        ['south  (south lever)', 2723, 9670],
        ['northRoom (north-room lever)', 2723, 9717],
        ['gold   (perfect gold rocks)', 2736, 9689]
    ];
    const claimed = new Set<number>();
    for (const [label, sx, sz] of seeds) {
        if (claimed.has(sx * 100_000 + sz)) {
            continue;
        }
        const seen = new Set<number>([sx * 100_000 + sz]);
        const stack = [[sx, sz]];
        let minX = sx, maxX = sx, minZ = sz, maxZ = sz;
        while (stack.length > 0) {
            const [x, z] = stack.pop() as [number, number];
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
            const mask = finder.exitMask(x, z, 0);
            for (let d = 0; d < 8; d++) {
                if ((mask & (1 << d)) === 0) {
                    continue;
                }
                const nx = x + DX[d]!, nz = z + DZ[d]!;
                if (!inMine(nx, nz)) {
                    continue;
                }
                const k = nx * 100_000 + nz;
                if (!seen.has(k)) {
                    seen.add(k);
                    stack.push([nx, nz]);
                }
            }
        }
        for (const k of seen) {
            claimed.add(k);
        }
        console.log(`  ${label}: ${seen.size} tiles, x[${minX}..${maxX}] z[${minZ}..${maxZ}]`);
    }
}

console.log(`pack: ${packPath}`);
console.log('\nrooms (doors removed — this is what mineRegion() encodes):');
floodRooms();

const chain = deriveChain();
if (chain.length === 0) {
    console.log('\nNO ROUTE to the perfect gold — the pack or the door list has drifted');
    process.exitCode = 1;
} else {
    console.log(`\nchain to the perfect gold (${chain.length} moves; walks collapsed):`);
    let at = { ...LANDING };
    for (const move of chain) {
        const walk = /^walk (\d+),(\d+)$/.exec(move);
        if (walk) {
            at = { x: Number(walk[1]), z: Number(walk[2]) };
            continue;
        }
        console.log(`  stand (${at.x},${at.z})  ${move}`);
        const landed = /→ (\d+),(\d+)$/.exec(move);
        if (landed) {
            at = { x: Number(landed[1]), z: Number(landed[2]) };
        }
    }
    console.log(`  arrive (${at.x},${at.z})`);
}
