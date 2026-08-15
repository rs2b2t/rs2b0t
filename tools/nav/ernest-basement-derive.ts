/** Derive the Ernest the Chicken basement route from the baked collision pack. defs/ernest/basement.ts is written against both outputs: the shortest levers-and-doors chain from the ladder landing to the oil can, BFS'd over (tile, 6 lever bits), and the seven regions the doors cut the basement into.
 *  Why: six levers interlock nine doors and the combination that opens one shuts another, so no walkthrough gives the chain in a form the walker can use; the region boxes are pairwise disjoint, which lets a tile alone name a room. A set bit means the lever is DOWN, transcribed from [oploc1,_haunted_door]; the nine doors sit in derive-doors.ts SCRIPT_REFUSED, so the navigator never routes through one. */

//   bun tools/nav/ernest-basement-derive.ts
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

const A = 1 << 0, B = 1 << 1, C = 1 << 2, D = 1 << 3, E = 1 << 4, F = 1 << 5;
/** True when the lever is DOWN. */
const down = (bits: number, mask: number): boolean => (bits & mask) !== 0;

const BOX = { minX: 3086, maxX: 3124, minZ: 9740, maxZ: 9775 };
const LANDING = { x: 3116, z: 9754 };
const OIL_CAN = { x: 3092, z: 9755 };
const LADDER_STAND = { x: 3117, z: 9755 };

interface Door { x: number; z: number; dx: number; dz: number; label: string; open: (b: number) => boolean }

const DOORS: Door[] = [
    { x: 3105, z: 9765, dx: -1, dz: 0, label: '1to2', open: b => !down(b, A) && !down(b, B) && down(b, D) && down(b, E) && down(b, F) },
    { x: 3100, z: 9765, dx: -1, dz: 0, label: '2to3', open: b => !down(b, B) && down(b, D) && down(b, F) },
    { x: 3105, z: 9760, dx: -1, dz: 0, label: '4to5', open: b => down(b, A) && down(b, B) && down(b, D) },
    { x: 3100, z: 9760, dx: -1, dz: 0, label: '5to6', open: b => down(b, D) },
    { x: 3100, z: 9755, dx: -1, dz: 0, label: '8to9', open: b => !down(b, E) && down(b, F) },
    { x: 3102, z: 9763, dx: 0, dz: -1, label: '2to5', open: b => !down(b, A) && !down(b, B) && down(b, C) && down(b, D) && !down(b, E) && down(b, F) },
    { x: 3097, z: 9763, dx: 0, dz: -1, label: '3to6', open: b => !down(b, B) && down(b, D) && !down(b, F) },
    { x: 3108, z: 9758, dx: 0, dz: -1, label: '4to7', open: b => down(b, A) && down(b, B) && !down(b, C) && !down(b, D) && !down(b, E) && !down(b, F) },
    { x: 3102, z: 9758, dx: 0, dz: -1, label: '5to8', open: b => (!down(b, C) && down(b, D)) || (!down(b, A) && !down(b, B) && down(b, C) && down(b, D) && !down(b, E) && down(b, F)) }
];

const LEVERS = [
    { x: 3108, z: 9745, bit: A, name: 'A' },
    { x: 3118, z: 9752, bit: B, name: 'B' },
    { x: 3112, z: 9760, bit: C, name: 'C' },
    { x: 3108, z: 9767, bit: D, name: 'D' },
    { x: 3097, z: 9767, bit: E, name: 'E' },
    { x: 3096, z: 9765, bit: F, name: 'F' }
];

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];

const inBox = (x: number, z: number): boolean =>
    x >= BOX.minX && x <= BOX.maxX && z >= BOX.minZ && z <= BOX.maxZ;

const key = (x: number, z: number, bits: number): number =>
    (((x - BOX.minX) << 6) | (z - BOX.minZ)) * 64 + bits;

function bfs(
    from: { x: number; z: number },
    isGoal: (x: number, z: number) => boolean,
    bits0: number
): string[] | null {
    const prev = new Map<number, { from: number; how: string }>();
    const start = key(from.x, from.z, bits0);
    const seen = new Set<number>([start]);
    const queue: { x: number; z: number; bits: number }[] = [{ ...from, bits: bits0 }];
    let goal: number | null = null;

    while (queue.length > 0 && goal === null) {
        const cur = queue.shift()!;
        const fromKey = key(cur.x, cur.z, cur.bits);
        const push = (x: number, z: number, bits: number, how: string): void => {
            const k = key(x, z, bits);
            if (seen.has(k)) {
                return;
            }
            seen.add(k);
            prev.set(k, { from: fromKey, how });
            if (isGoal(x, z)) {
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
            if (inBox(nx, nz)) {
                push(nx, nz, cur.bits, `walk ${nx},${nz}`);
            }
        }
        for (const door of DOORS) {
            if (!door.open(cur.bits)) {
                continue;
            }
            const far = { x: door.x + door.dx, z: door.z + door.dz };
            if (cur.x === door.x && cur.z === door.z) {
                push(far.x, far.z, cur.bits, `OPEN ${door.label} -> ${far.x},${far.z}`);
            }
            if (cur.x === far.x && cur.z === far.z) {
                push(door.x, door.z, cur.bits, `OPEN ${door.label} -> ${door.x},${door.z}`);
            }
        }
        for (const lever of LEVERS) {
            if (Math.max(Math.abs(cur.x - lever.x), Math.abs(cur.z - lever.z)) > 1) {
                continue;
            }
            const bits = cur.bits ^ lever.bit;
            push(cur.x, cur.z, bits, `PULL ${lever.name} ${down(bits, lever.bit) ? 'down' : 'up'}`);
        }
    }

    if (goal === null) {
        return null;
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

function report(title: string, from: { x: number; z: number }, chain: string[] | null, bits0 = 0): number {
    console.log(`\n${title}`);
    if (!chain) {
        console.log('  NO ROUTE');
        return -1;
    }
    let at = { ...from };
    let bits = bits0;
    for (const move of chain) {
        const walk = /^walk (\d+),(\d+)$/.exec(move);
        if (walk) {
            at = { x: Number(walk[1]), z: Number(walk[2]) };
            continue;
        }
        console.log(`  stand (${at.x},${at.z})  ${move}`);
        const pull = /^PULL ([A-F])/.exec(move);
        if (pull) {
            bits ^= LEVERS.find(l => l.name === pull[1])!.bit;
        }
        const landed = /-> (\d+),(\d+)$/.exec(move);
        if (landed) {
            at = { x: Number(landed[1]), z: Number(landed[2]) };
        }
    }
    console.log(`  arrive (${at.x},${at.z})  bits=${bits.toString(2).padStart(6, '0')}`);
    return bits;
}

function floodRegions(): void {
    const claimed = new Set<string>();
    for (let x = BOX.minX; x <= BOX.maxX; x++) {
        for (let z = BOX.minZ; z <= BOX.maxZ; z++) {
            if (claimed.has(`${x},${z}`) || !finder.walkable(x, z, 0)) {
                continue;
            }
            const stack = [[x, z]];
            claimed.add(`${x},${z}`);
            const own = new Set<string>([`${x},${z}`]);
            let minX = x, maxX = x, minZ = z, maxZ = z;
            while (stack.length > 0) {
                const [cx, cz] = stack.pop() as [number, number];
                minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
                minZ = Math.min(minZ, cz); maxZ = Math.max(maxZ, cz);
                const mask = finder.exitMask(cx, cz, 0);
                for (let d = 0; d < 8; d++) {
                    if ((mask & (1 << d)) === 0) {
                        continue;
                    }
                    const nx = cx + DX[d]!, nz = cz + DZ[d]!;
                    if (!inBox(nx, nz) || claimed.has(`${nx},${nz}`)) {
                        continue;
                    }
                    claimed.add(`${nx},${nz}`);
                    own.add(`${nx},${nz}`);
                    stack.push([nx, nz]);
                }
            }
            const marks: string[] = [];
            for (const l of LEVERS) {
                if (own.has(`${l.x},${l.z}`)) {
                    marks.push(`lever${l.name}`);
                }
            }
            if (own.has(`${LANDING.x},${LANDING.z}`)) marks.push('LADDER');
            if (own.has(`${OIL_CAN.x},${OIL_CAN.z}`)) marks.push('OILCAN');
            if (own.size > 3) {
                console.log(`  ${own.size} tiles x[${minX}..${maxX}] z[${minZ}..${maxZ}] ${marks.join(' ')}`);
            }
        }
    }
}

console.log(`pack: ${packPath}`);
console.log('\nregions (doors closed — this is what basementRegion() encodes):');
floodRegions();

const chain = bfs(LANDING, (x, z) => x === OIL_CAN.x && z === OIL_CAN.z, 0);
const endBits = report(`chain: landing (${LANDING.x},${LANDING.z}) -> oil can`, LANDING, chain);
if (endBits < 0) {
    console.log('\nNO ROUTE to the oil can — the pack or the door list has drifted');
    process.exitCode = 1;
} else {
    report(`chain out: oil can -> ladder (${LADDER_STAND.x},${LADDER_STAND.z})`, OIL_CAN,
        bfs(OIL_CAN, (x, z) => x === LADDER_STAND.x && z === LADDER_STAND.z, endBits), endBits);
}
