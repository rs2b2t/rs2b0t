/** Reachability probe for Horror from the Deep (#216): every tile the module names, checked against a flood from the mainland, plus the ten barcrawl bars.
 *  Why: the broken lighthouse copy, the basement and the cavern are linked by scripted teleport alone, so they are expected to be components of their own and are listed as such. */
import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import doorsJson from '../../src/bot/event/webwalk/data/doors.json';
import transportsJson from '../../src/bot/event/webwalk/data/transports.json';
import stairsJson from '../../src/bot/event/webwalk/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/event/webwalk/PathFinder.js';
import { BARS } from '../../src/bot/api/ai/quests/barcrawl/BarcrawlLogic.js';
import { HD_TILE } from '../../src/bot/api/ai/quests/defs/horror/areas.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson);

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const nodeId = (x: number, z: number, l: number): number => (l << 28) | (x << 14) | z;
const edges: Map<number, { to: number }[]> = (finder as unknown as { edges: Map<number, { to: number }[]> }).edges;

function flood(p: NavPoint): Set<number> {
    const seen = new Set<number>();
    const stack = [nodeId(p.x, p.z, p.level)];
    seen.add(stack[0]);
    while (stack.length) {
        const cur = stack.pop()!;
        const x = (cur >> 14) & 0x3fff, z = cur & 0x3fff, level = (cur >> 28) & 0x3;
        const mask = finder.exitMask(x, z, level);
        for (let d = 0; d < 8; d++) {
            if ((mask & (1 << d)) === 0) {
                continue;
            }
            const n = nodeId(x + DX[d], z + DZ[d], level);
            if (!seen.has(n)) {
                seen.add(n);
                stack.push(n);
            }
        }
        for (const e of edges.get(cur) ?? []) {
            if (!seen.has(e.to)) {
                seen.add(e.to);
                stack.push(e.to);
            }
        }
    }
    return seen;
}

/** Ardougne, so the flood starts nowhere near the causeway it is testing. */
const main = flood({ x: 2612, z: 3092, level: 0 });
const inMain = (p: NavPoint): boolean => main.has(nodeId(p.x, p.z, p.level));

/** Pockets nothing walks into: the map links them by scripted teleport only. */
const SEALED = new Set([
    'QUEST_LIGHTHOUSE_L0', 'QUEST_STAIRS_BASE', 'QUEST_LADDER', 'QUEST_STAIRS_L1',
    'QUEST_BOOKCASE', 'QUEST_STAIRS_L2', 'QUEST_LIGHT', 'REAL_STAIRS_L2', 'REAL_LIGHTHOUSE_L0',
    'BASEMENT_LADDER', 'WALL_SOUTH', 'WALL_NORTH', 'BASEMENT_DOWN',
    'CAVERN_LANDING', 'JOSSIK', 'POSTQUEST_CAVERN', 'POSTQUEST_LADDER'
]);

const stands: [string, NavPoint][] = [];
for (const [key, value] of Object.entries(HD_TILE)) {
    if (Array.isArray(value)) {
        value.forEach((tile, i) => stands.push([`${key}[${i}]`, tile as NavPoint]));
    } else {
        stands.push([key, value as NavPoint]);
    }
}
for (const bar of BARS) {
    stands.push([`bar:${bar.line}`, bar.tile as NavPoint]);
}

let bad = 0;
for (const [name, p] of stands) {
    const walkable = finder.exitMask(p.x, p.z, p.level) !== 0;
    const reached = inMain(p);
    const sealed = SEALED.has(name.replace(/\[\d+\]$/, ''));
    const ok = walkable && (reached || sealed);
    if (!ok) {
        bad++;
    }
    console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(22)} (${p.x},${p.z},L${p.level})`
        + ` walkable=${walkable ? 'Y' : 'n'} mainland=${reached ? 'Y' : 'n'}${sealed ? ' (sealed pocket)' : ''}`
    );
}
console.log(bad === 0 ? '\nall stands accounted for' : `\n${bad} stand(s) unaccounted for`);

// For anything the flood could not reach, name the nearest tile it could — an
// anchor one tile inside a wall reads like a sealed room.
const NEAR: [string, NavPoint][] = stands.filter(([n, p]) =>
    !SEALED.has(n.replace(/\[\d+\]$/, '')) && !inMain(p));
if (NEAR.length > 0) {
    console.log('\nnearest mainland tile to each miss:');
    for (const [name, p] of NEAR) {
        let best: { x: number; z: number; d: number } | null = null;
        for (let dx = -12; dx <= 12; dx++) {
            for (let dz = -12; dz <= 12; dz++) {
                const q = { x: p.x + dx, z: p.z + dz, level: p.level };
                if (!inMain(q)) {
                    continue;
                }
                const d = Math.max(Math.abs(dx), Math.abs(dz));
                if (!best || d < best.d) {
                    best = { x: q.x, z: q.z, d };
                }
            }
        }
        console.log(`  ${name.padEnd(22)} -> ${best ? `(${best.x},${best.z},L${p.level}) at ${best.d} tiles` : 'nothing within 12'}`);
    }
}
