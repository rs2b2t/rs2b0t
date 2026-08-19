/** Pathfind to every tile the Temple of Ikov module names, and name the pockets nothing routes into.
 *  Why: the temple is five stage-gated doors, a lava bridge, a webbed alcove and a wall you push, so which tiles the baked graph reaches is the difference between a leg and a wedge. */

//   bun tools/nav/build-collision.ts --engine ~/code/rs2b2t-engine
//   bun tools/nav/ikov-probe.ts
import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import doorsJson from '../../src/bot/event/webwalk/data/doors.json';
import stairsJson from '../../src/bot/event/webwalk/data/stairEdges.json';
import transportsJson from '../../src/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint } from '../../src/bot/event/webwalk/PathFinder.js';
import { ICE_CHESTS, IKOV_TILE } from '../../src/bot/api/ai/quests/defs/ikov/areas.js';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as never, stairsJson);

const point = (t: { x: number; z: number; level: number }): NavPoint => ({ x: t.x, z: t.z, level: t.level });

/** Chest stands: `forceapproach=north` rotates clockwise with each placement angle. */
const CHEST_STANDS: NavPoint[] = [
    { x: 2710, z: 9849, level: 0 },
    { x: 2719, z: 9839, level: 0 },
    { x: 2729, z: 9849, level: 0 },
    { x: 2739, z: 9835, level: 0 },
    { x: 2745, z: 9822, level: 0 },
    { x: 2746, z: 9848, level: 0 }
];

const FROM: [string, NavPoint][] = [
    ['Ardougne West bank', point(IKOV_TILE.ARDOUGNE_BANK)],
    ['temple entrance', point(IKOV_TILE.TEMPLE_LADDER)]
];

const TO: [string, NavPoint][] = [
    ['Lucien (inn)', point(IKOV_TILE.LUCIEN_INN)],
    ['Lucien (hut)', point(IKOV_TILE.LUCIEN_HUT)],
    ["Aemad's", point(IKOV_TILE.AEMAD)],
    ['Candle maker', point(IKOV_TILE.CANDLE_MAKER)],
    ['Arhein', point(IKOV_TILE.ARHEIN)],
    ['knife spawn', point(IKOV_TILE.KNIFE_SPAWN)],
    ['yew trees', point(IKOV_TILE.YEW_TREES)],
    ['flax field', point(IKOV_TILE.FLAX_FIELD)],
    ['spinning wheel', point(IKOV_TILE.SPINNING_WHEEL)],
    ['hobgoblins', point(IKOV_TILE.HOBGOBLINS)],
    ['dungeon entrance', point(IKOV_TILE.ENTRANCE)],
    ['Door of Fear (south)', point(IKOV_TILE.FEAR_GATE_SOUTH)],
    ['south gate (north)', point(IKOV_TILE.SOUTH_GATE_NORTH)],
    ['lever bracket', point(IKOV_TILE.LEVER_BRACKET)],
    ['dark stairs down', point(IKOV_TILE.DARK_STAIRS_DOWN)],
    ['trap lever', point(IKOV_TILE.TRAP_LEVER)],
    ['bridge, east bank', point(IKOV_TILE.BRIDGE_EAST)],
    ['fire warrior door', point(IKOV_TILE.FIRE_DOOR_SOUTH)],
    ['Winelda', point(IKOV_TILE.WINELDA)],
    ...CHEST_STANDS.map((stand, i): [string, NavPoint] => [`ice chest ${i + 1} stand`, stand])
];

// Why: each of these is entered by a script the graph cannot express, so "unreachable" here is the design and a route appearing would be the bug.
const POCKETS: [string, NavPoint][] = [
    ['boots room (dark stairs)', point(IKOV_TILE.DARK_LANDING)],
    ['boots alcove (webbed)', point(IKOV_TILE.BOOTS_SPAWN)],
    ['west of the lava bridge', point(IKOV_TILE.BRIDGE_WEST)],
    ['Lever spawn', point(IKOV_TILE.IKOV_LEVER_SPAWN)],
    ['trap pit', { x: 2682, z: 9854, level: 0 }],
    ["guardians' temple", point(IKOV_TILE.GUARDIANS)],
    ['Staff of Armadyl', { x: 2638, z: 9906, level: 0 }]
];

let unreachable = 0;
for (const [fromName, from] of FROM) {
    console.log(`from ${fromName} (${from.x},${from.z},${from.level}):`);
    for (const [name, to] of TO) {
        const out = finder.findPath(from, to, undefined, 2_000_000);
        if (!out.ok) {
            unreachable++;
            console.log(`  UNREACHABLE  ${name.padEnd(24)} (${to.x},${to.z},${to.level}) — ${out.reason}`);
            continue;
        }
        const last = out.waypoints[out.waypoints.length - 1];
        // Why: findPath snapping to within five tiles is a weaker claim than walkResilient(radius 2) arriving.
        const snapped = Math.max(Math.abs(last.x - to.x), Math.abs(last.z - to.z));
        if (snapped > 2) {
            unreachable++;
        }
        console.log(`  ${snapped > 2 ? 'SNAPPED' : 'ok     '} ${name.padEnd(24)} (${to.x},${to.z},${to.level}) cost ${out.cost}, snapped ${snapped}`);
    }
}

console.log('\nsealed pockets — the module drives each of these itself:');
for (const [name, to] of POCKETS) {
    const out = finder.findPath(point(IKOV_TILE.TEMPLE_LADDER), to, undefined, 2_000_000);
    console.log(`  ${out.ok ? 'ROUTED  ' : 'sealed  '} ${name.padEnd(26)} (${to.x},${to.z},${to.level})`);
}

console.log(`\nWinelda's landing is reached by her teleport; the shiny key door is the way back out (${ICE_CHESTS.length} chests probed).`);

if (unreachable > 0) {
    console.error(`${unreachable} tile(s) unreachable`);
    process.exit(1);
}
