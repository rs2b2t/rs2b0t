// Offline nav-target coverage check (sibling of bench-path.ts). Verifies every
// tile a bot web-walks to (src/bot/nav/data/navTargets.ts) is walkable AND
// connected to the main graph in the baked collision pack, so a sealed-nook
// config is caught. Prints each bad tile + the nearest connected replacement.
// Exits non-zero on any UNEXPECTED non-ok target (expected:'island' entries are
// documented known cases and do not fail the gate).
//
// Prereq: bun run build:bot (produces out/collision.lcnav.gz).
// Usage: bun tools/nav/coverage.ts [--pack out/collision.lcnav.gz] [--anchor 3221,3218]

import fs from 'node:fs';
import { gunzipSync } from 'fflate';
import doorsJson from '../../src/bot/nav/data/doors.json';
import transportsJson from '../../src/bot/nav/data/transports.json';
import stairsJson from '../../src/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/nav/PathFinder.js';
import { NAV_TARGETS } from '../../src/bot/nav/data/navTargets.js';
import { classifyTarget, nearestConnected, type ReachChecker } from '../../src/bot/nav/coverageLogic.js';

const BUDGET = 1_000_000;
const MAX_RING = 8;

const args = process.argv.slice(2);
const optVal = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const packPath = optVal('--pack') ?? 'out/collision.lcnav.gz';
const anchorArg = optVal('--anchor');
const anchor: NavPoint = anchorArg
    ? { x: Number(anchorArg.split(',')[0]), z: Number(anchorArg.split(',')[1]), level: 0 }
    : { x: 3221, z: 3218, level: 0 };

let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) { bytes = gunzipSync(bytes); }
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson, stairsJson);

const rc: ReachChecker = {
    walkable: (x, z, level) => finder.walkable(x, z, level),
    connected: (from, a) => finder.findPath(from, a, undefined, BUDGET).ok
};

console.log(`nav-target coverage: ${NAV_TARGETS.length} targets, anchor (${anchor.x},${anchor.z},${anchor.level}), pack ${packPath}`);
let failures = 0;
for (const t of NAV_TARGETS) {
    const kind = classifyTarget(rc, t.tile, anchor);
    if (kind === 'ok') {
        console.log(`ok        ${t.bot} — ${t.label} (${t.tile.x},${t.tile.z},${t.tile.level})`);
        continue;
    }
    if (t.expected === kind) {
        console.log(`expected  ${t.bot} — ${t.label} (${t.tile.x},${t.tile.z},${t.tile.level}): ${kind} (known/handled)`);
        continue;
    }
    const near = nearestConnected(rc, t.tile, anchor, MAX_RING);
    console.log(`FAIL      ${t.bot} — ${t.label} (${t.tile.x},${t.tile.z},${t.tile.level}): ${kind}; nearest connected = ${near ? `(${near.x},${near.z},${near.level})` : 'none within ' + MAX_RING}`);
    failures++;
}
console.log(failures === 0 ? '\nall nav-targets reachable (or expected)' : `\n${failures} unreachable nav-target(s)`);
process.exit(failures === 0 ? 0 : 1);
