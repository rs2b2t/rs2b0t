/** The seam graph of Tirannwn, and the routes it admits between Regicide's landmarks. */

// Why: a component report over the quest's own anchors answers FAIL for every pair inside Tirannwn — the forest is two dozen sealed pockets whose only joins are scripted crossings the collision pack marks blocked. This derives that graph from the map so a leg is written against measured connectivity.
// Why: a seam is found by which pockets stand around the crossing loc, never by re-deriving the script's own forcemove arithmetic — the tripwires and pitfalls each land the player a different distance out, and guessing that produced a graph with four dead ends in it.
// Why: the dense-forest crossings are refused until `%regicide_quest >= ^regicide_spoken_tracker2`, so the routes are printed twice — once for the early quest, once for the rest of it.

//   bun tools/nav/regicide-pockets.ts            # report
//   bun tools/nav/regicide-pockets.ts --bake     # rewrite src/bot/api/ai/quests/defs/regicide/seams.ts

import fs from 'node:fs';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';

import { Reader, forEachLoc, loadMapsquares, loadLocTypes } from './lib.js';

const ENGINE = process.env.ENGINE_DIR ?? `${process.env.HOME}/code/rs2b2t-engine`;
const BAKE = process.argv.includes('--bake');
const OUT = 'src/bot/api/ai/quests/defs/regicide/seams.ts';

let bytes: Uint8Array = new Uint8Array(fs.readFileSync('out/collision.lcnav.gz'));
if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = gunzipSync(bytes);
}
const finder = new PathFinder(bytes);
loadDefaultNavEdges(finder);

/** Every tile the quest stands on, so a discovered pocket gets a name that means something. */
const LANDMARKS: [string, NavPoint][] = [
    // Why: the Arandar palisade is the only join between Tirannwn and the rest of the map, and it is not in doors.json — the two sides are separate components to the navigator, so both get a name.
    ['ardougne', { x: 2384, z: 3337, level: 0 }],
    ['arandar', { x: 2384, z: 3331, level: 0 }],
    ['isafdar-entry', { x: 2313, z: 3215, level: 0 }],
    ['quarry', { x: 2322, z: 3268, level: 0 }],
    ['elf-camp', { x: 2205, z: 3252, level: 0 }],
    ['old-camp', { x: 2257, z: 3149, level: 0 }],
    ['old-camp-west', { x: 2231, z: 3149, level: 0 }],
    ['catapult', { x: 2185, z: 3183, level: 0 }],
    ['camp-approach', { x: 2188, z: 3168, level: 0 }],
    ['camp-middle', { x: 2188, z: 3165, level: 0 }],
    ['tyras-camp', { x: 2188, z: 3162, level: 0 }]
];

// Why: a pocket is what can be WALKED, never what a pathfind can reach. An offline `findPath` crosses every baked door, stair and shortcut edge with no world state to gate them, so labelling by one merged the two sides of the Arandar palisade into a single pocket — and the live walker, which does apply those gates, answered "no path to (2384,3333): unreachable" on the way out of the forest.
const STEP_DIRS = [
    [0, 1, 0x1],
    [1, 0, 0x2],
    [0, -1, 0x4],
    [-1, 0, 0x8]
] as const;
/** A backstop for the mainland flood, which is the rest of the map. */
const FLOOD_CAP = 400_000;

const tileKey = (x: number, z: number): number => x * 100_000 + z;

/** Every tile reachable from a seed on foot alone. */
function flood(seed: NavPoint): Set<number> {
    const seen = new Set<number>([tileKey(seed.x, seed.z)]);
    const queue: [number, number][] = [[seed.x, seed.z]];
    while (queue.length > 0 && seen.size < FLOOD_CAP) {
        const [x, z] = queue.shift()!;
        const mask = finder.exitMask(x, z, 0);
        for (const [dx, dz, bit] of STEP_DIRS) {
            if ((mask & bit) === 0) {
                continue;
            }
            const key = tileKey(x + dx, z + dz);
            if (!seen.has(key)) {
                seen.add(key);
                queue.push([x + dx, z + dz]);
            }
        }
    }
    return seen;
}

// Why: a pocket is what the WALKER can reach, which is more than plain walking — it opens ordinary doors and takes ordinary shortcuts — and less than an offline pathfind, which has no world state to gate anything with. So the test is a pathfind that refuses the quest's own crossings: those are what the module takes by hand, and a labeller that walked them merged the two sides of the Arandar palisade into one pocket. The live walker then answered "no path to (2384,3333): unreachable" on the way out of the forest.
// Why: the log balances are the only crossing `derive-transports` bakes as an edge of its own, and the live walker refuses them — so an offline pathfind that takes one merges two pockets the module has to cross by hand, which is how the walk out of the forest ended at "no path to (2384,3333): unreachable". Everything else the pathfinder can do here, the walker can do too.
const components: { name: string; rep: NavPoint; tiles: Set<number> }[] = [];
const cache = new Map<number, string | null>();

// Why: the Arandar palisade is the one crossing in this quest the offline pathfinder walks straight over — it is not in `doors.json`, so the search steps across the gate's tile as if it were open ground, and the two sides come back as one pocket. The live walker knows better, and answered "no path to (2384,3333): unreachable" on the way out of the forest. Both sides are therefore pinned by a walk-only flood, which the palisade does block, and never matched by the pathfind below.
const PINNED = ['arandar', 'ardougne'];

function pinPalisade(): void {
    for (const name of PINNED) {
        const at = LANDMARKS.find(([label]) => label === name)![1];
        components.push({ name, rep: at, tiles: flood(at) });
    }
}

/** Which pocket a tile sits in, or null when the pack calls it unwalkable. */
function pocketOf(t: NavPoint): string | null {
    const key = tileKey(t.x, t.z);
    const seen = cache.get(key);
    if (seen !== undefined) {
        return seen;
    }
    if (finder.exitMask(t.x, t.z, 0) === 0) {
        cache.set(key, null);
        return null;
    }
    const pinned = components.find(c => PINNED.includes(c.name) && c.tiles.has(key));
    let name = pinned?.name;
    name ??= components
        .find(c => !PINNED.includes(c.name) && (c.tiles.has(key) || finder.findPath(t, c.rep, undefined, 200_000).ok))
        ?.name;
    if (name === undefined) {
        const tiles = flood(t);
        const landmark = LANDMARKS.find(
            ([label, at]) => !PINNED.includes(label) && (tiles.has(tileKey(at.x, at.z)) || finder.findPath(t, at, undefined, 200_000).ok)
        );
        name = landmark?.[0] ?? `p${components.filter(c => c.name.startsWith('p')).length + 1}`;
        components.push({ name, rep: t, tiles });
    }
    cache.set(key, name);
    return name;
}

const { names } = loadLocTypes(ENGINE);
const byId = new Map<number, string>();
for (const [name, id] of names) {
    byId.set(id, name);
}
const idOf = (name: string): number => names.get(name)!;

/** Every loc whose op moves the player across ground the pack calls blocked. */
const SEAM_LOCS = new Map<number, { op: string; kind: 'forest' | 'log' | 'pit' | 'trap' | 'gate' }>([
    [idOf('overpass_gate_left'), { op: 'Enter', kind: 'gate' }],
    [idOf('overpass_gate_right'), { op: 'Enter', kind: 'gate' }],
    [idOf('regicide_cross_over1'), { op: 'Enter', kind: 'forest' }],
    [idOf('regicide_cross_over2'), { op: 'Enter', kind: 'forest' }],
    [idOf('regicide_cross_over3'), { op: 'Enter', kind: 'forest' }],
    [idOf('regicide_cross_over1_tyras_camp'), { op: 'Enter', kind: 'forest' }],
    [idOf('regicide_cross_over2_tyras_camp'), { op: 'Enter', kind: 'forest' }],
    [idOf('regicide_logbalance1_start'), { op: 'Cross', kind: 'log' }],
    [idOf('regicide_logbalance2_start'), { op: 'Cross', kind: 'log' }],
    [idOf('regicide_logbalance3_start'), { op: 'Cross', kind: 'log' }],
    [idOf('regicide_pitfall_side'), { op: 'Jump', kind: 'pit' }],
    [idOf('regicide_trap_tripwire'), { op: 'Step-over', kind: 'trap' }],
    [idOf('regicide_trap_woodspring'), { op: 'Pass', kind: 'trap' }]
]);

interface Seam {
    kind: 'forest' | 'log' | 'pit' | 'trap' | 'gate';
    loc: string;
    locId: number;
    op: string;
    x: number;
    z: number;
    /** One walkable stand tile per pocket the crossing joins. */
    sides: { pocket: string; stand: NavPoint }[];
    /** True when the loc only works from `sides[0]` — the pitfalls and the log balances are one-way. */
    directed?: boolean;
}

// Why: a pitfall's four `_side` locs and a log balance's two `_start` locs are each usable from one side only. `regicide_jump_pitfall` stages the player one tile off the loc AWAY from the player, so clicking the far loc from the near bank stages them inside the pit and the trap timer drops them in before the jump runs — which is what three consecutive falls into the same pit looked like on the first live run.
const DIRECTED = new Set(['pit', 'log']);

const at = (x: number, z: number): NavPoint => ({ x, z, level: 0 });

/** Every `regicide_pitfall_mid` placement, so a side loc can be told which way it faces. */
const PIT_MIDS: NavPoint[] = [];
/** Every log balance start, so each one can find the bank its partner stands on. */
const LOG_STARTS: { locId: number; x: number; z: number }[] = [];

function pitMid(x: number, z: number): NavPoint | null {
    return PIT_MIDS.find(mid => Math.abs(mid.x - x) + Math.abs(mid.z - z) === 1) ?? null;
}

// Why: the far plank of a log balance is walkable and goes nowhere — one tile with an exit onto the log and none onto the bank. A stand has to be ground something can walk off, or the two ends of the same crossing come back as two different pockets and the route only plans one way round.
const MIN_STAND_TILES = 4;

/** The first tile the pack calls walkable AND walkable off, starting where told and stepping outwards. */
function firstWalkable(x: number, z: number, dx: number, dz: number, tries = 4): NavPoint | null {
    for (let step = 0; step < tries; step++) {
        const tile = at(x + dx * step, z + dz * step);
        if (finder.exitMask(tile.x, tile.z, 0) !== 0 && flood(tile).size >= MIN_STAND_TILES) {
            return tile;
        }
    }
    return null;
}

/**
 * The two tiles a crossing joins, read off the script that performs it.
 * Why: derived rather than searched. A ring search around the loc is simpler and wrong here — the three dense-forest crossings west of the elf camp sit three tiles apart, so any ring wide enough to reach a pitfall's landing tile also reaches past the neighbouring crossing and claims one seam does the work of three.
 */
function sidesOf(locId: number, x: number, z: number, angle: number, name: string): [NavPoint, NavPoint] | null {
    const acrossX = angle === 1 || angle === 3;
    if (SEAM_LOCS.get(locId)?.kind === 'forest') {
        // `_regicide_cross_over`: $start and $dest, one tile off each end of the 3x2 footprint.
        return acrossX ? [at(x - 1, z + 1), at(x + 2, z + 1)] : [at(x + 1, z - 1), at(x + 1, z + 2)];
    }
    if (name.startsWith('regicide_logbalance')) {
        // `regicide_logbalance`: loc_coord, then ±1, then ±2, then ±2 — five tiles out, away from the centre.
        // Why: the log spans a chasm, so its own tile and the one it lands on are both unwalkable to the pack even though the loc does not block, and the far end is the OTHER start loc's own bank rather than a fixed offset — the tile the forcemove chain lands on is the far plank, which the pack reads as a one-tile island. So the banks either side are found by scanning outwards; taking the plank for the stand gave the two ends of one log two different pockets and a route that only planned one way.
        const horizontal = name !== 'regicide_logbalance3_start';
        const centre = name === 'regicide_logbalance1_start' ? 2200 : 2261;
        const forward = horizontal ? (x < centre ? 1 : -1) : (z < 3235 ? 1 : -1);
        const dx = horizontal ? forward : 0;
        const dz = horizontal ? 0 : forward;
        const partner = LOG_STARTS.find(
            other => other.locId === locId && (horizontal ? other.z === z && other.x !== x : other.x === x && other.z !== z)
        );
        if (partner === undefined) {
            return null;
        }
        const near = firstWalkable(x - dx, z - dz, -dx, -dz);
        const far = firstWalkable(partner.x + dx, partner.z + dz, dx, dz);
        return near && far ? [near, far] : null;
    }
    if (name === 'regicide_pitfall_side') {
        // `regicide_jump_pitfall`: staged one tile off the side loc on the player's own side, and landed three past it. Which side that is comes from where the loc sits around its pit, not from its angle — a side loc is only ever taken from the bank it faces.
        const mid = pitMid(x, z);
        if (mid === null) {
            return null;
        }
        const dx = x - mid.x;
        const dz = z - mid.z;
        return [at(x + dx, z + dz), at(x - dx * 3, z - dz * 3)];
    }
    if (name === 'regicide_trap_tripwire') {
        // `oploc1,regicide_trap_tripwire`: three net tiles from the stand, over a 1x2 footprint.
        return acrossX ? [at(x + 2, z), at(x - 1, z)] : [at(x, z + 2), at(x, z - 1)];
    }
    if (name.startsWith('overpass_gate')) {
        // `arandar_gate`: two tiles north or south of wherever the click was made, from beside the palisade.
        return [at(x, z - 1), at(x, z + 1)];
    }
    if (name === 'regicide_trap_woodspring') {
        // `oploc1,regicide_trap_woodspring`: one tile off each end of the 3x1 footprint.
        return acrossX ? [at(x, z - 1), at(x, z + 3)] : [at(x - 1, z), at(x + 3, z)];
    }
    return null;
}

const PIT_MID_ID = idOf('regicide_pitfall_mid');
const LOG_IDS = [...SEAM_LOCS].filter(([, spec]) => spec.kind === 'log').map(([id]) => id);
const squares = loadMapsquares(ENGINE);
for (const square of squares) {
    forEachLoc(new Reader(square.loc), loc => {
        if (loc.locId === PIT_MID_ID) {
            PIT_MIDS.push(at(square.mx * 64 + loc.x, square.mz * 64 + loc.z));
        }
        if (LOG_IDS.includes(loc.locId)) {
            LOG_STARTS.push({ locId: loc.locId, x: square.mx * 64 + loc.x, z: square.mz * 64 + loc.z });
        }
    });
}

pinPalisade();

const seams: Seam[] = [];
for (const square of squares) {
    forEachLoc(new Reader(square.loc), loc => {
        const spec = SEAM_LOCS.get(loc.locId);
        const x = square.mx * 64 + loc.x;
        const z = square.mz * 64 + loc.z;
        // Why: mapsquare 36_71 holds the instanced copy of the camp the catapult cutscene plays in.
        if (spec === undefined || z > 4000 || x > 2500) {
            return;
        }
        const name = byId.get(loc.locId) ?? String(loc.locId);
        const ends = sidesOf(loc.locId, x, z, loc.angle, name);
        if (ends === null) {
            return;
        }
        const sides = ends
            .map(stand => ({ pocket: pocketOf(stand), stand }))
            .filter((s): s is { pocket: string; stand: NavPoint } => s.pocket !== null);
        if (sides.length < 2 || sides[0].pocket === sides[1].pocket) {
            return;
        }
        const seam: Seam = { kind: spec.kind, loc: name, locId: loc.locId, op: spec.op, x, z, sides };
        if (DIRECTED.has(spec.kind)) {
            seam.directed = true;
        }
        seams.push(seam);
    });
}

console.log('== seams ==');
for (const seam of [...seams].sort((a, b) => a.loc.localeCompare(b.loc) || a.x - b.x || a.z - b.z)) {
    const sides = seam.sides.map(s => `${s.pocket}(${s.stand.x},${s.stand.z})`).join(seam.directed ? ' --> ' : ' <-> ');
    console.log(`  ${seam.loc.padEnd(32)} @(${seam.x},${seam.z}) ${seam.op.padEnd(9)} ${sides}`);
}
console.log(`  ${seams.length} seams over ${components.length} pockets`);

console.log('\n== landmark pockets ==');
for (const [name, at] of LANDMARKS) {
    console.log(`  ${name.padEnd(16)} (${at.x},${at.z}) -> ${pocketOf(at) ?? 'UNWALKABLE'}`);
}

interface Leg {
    seam: Seam;
    from: { pocket: string; stand: NavPoint };
    to: { pocket: string; stand: NavPoint };
}

function plan(from: string, to: string, forests: boolean): Leg[] | null {
    const usable = seams.filter(s => forests || s.kind !== 'forest');
    const prev = new Map<string, Leg>();
    const queue = [from];
    const seen = new Set([from]);
    while (queue.length > 0) {
        const at = queue.shift()!;
        if (at === to) {
            const legs: Leg[] = [];
            for (let cursor = to; cursor !== from; ) {
                const leg = prev.get(cursor)!;
                legs.unshift(leg);
                cursor = leg.from.pocket;
            }
            return legs;
        }
        for (const seam of usable) {
            const here = seam.directed
                ? (seam.sides[0].pocket === at ? seam.sides[0] : undefined)
                : seam.sides.find(s => s.pocket === at);
            if (here === undefined) {
                continue;
            }
            for (const other of seam.sides) {
                if (other.pocket === at || seen.has(other.pocket)) {
                    continue;
                }
                seen.add(other.pocket);
                prev.set(other.pocket, { seam, from: here, to: other });
                queue.push(other.pocket);
            }
        }
    }
    return null;
}

const LEGS: [string, string][] = [
    ['ardougne', 'isafdar-entry'],
    ['elf-camp', 'ardougne'],
    ['isafdar-entry', 'elf-camp'],
    ['elf-camp', 'old-camp'],
    ['old-camp', 'catapult'],
    ['catapult', 'tyras-camp'],
    ['tyras-camp', 'elf-camp'],
    ['catapult', 'elf-camp'],
    ['elf-camp', 'quarry'],
    ['old-camp', 'elf-camp'],
    ['isafdar-entry', 'old-camp'],
    ['elf-camp', 'catapult']
];

for (const forests of [false, true]) {
    console.log(`\n== routes ${forests ? 'with' : 'without'} the dense-forest crossings ==`);
    for (const [from, to] of LEGS) {
        const legs = plan(from, to, forests);
        if (legs === null) {
            console.log(`  ${from} -> ${to}: NO ROUTE`);
            continue;
        }
        const text = legs
            .map(l => `${l.from.pocket} @(${l.from.stand.x},${l.from.stand.z}) -[${l.seam.op} ${l.seam.loc} @(${l.seam.x},${l.seam.z})]-> ${l.to.pocket}`)
            .join('\n      ');
        console.log(`  ${from} -> ${to}:\n      ${text}`);
    }
}

/**
 * One pocket's tiles as `[z, xStart, xEnd]` runs.
 * Why: the module has to answer "which pocket am I in" from a tile alone, and the client's own reachability probe only sees the loaded scene — a pocket ninety tiles across does not fit in it.
 */
function spansOf(tiles: Set<number>): [number, number, number][] {
    const rows = new Map<number, number[]>();
    for (const key of tiles) {
        const row = rows.get(key % 100_000) ?? [];
        row.push(Math.floor(key / 100_000));
        rows.set(key % 100_000, row);
    }
    const spans: [number, number, number][] = [];
    for (const [z, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
        xs.sort((a, b) => a - b);
        let start = xs[0];
        let last = xs[0];
        for (const x of xs.slice(1)) {
            if (x === last + 1) {
                last = x;
                continue;
            }
            spans.push([z, start, last]);
            start = x;
            last = x;
        }
        spans.push([z, start, last]);
    }
    return spans;
}

if (BAKE) {
    const rows = seams
        .sort((a, b) => a.x - b.x || a.z - b.z)
        .map(s => `    { kind: '${s.kind}', loc: '${s.loc}', locId: ${s.locId}, op: '${s.op}', x: ${s.x}, z: ${s.z}${s.directed ? ', directed: true' : ''}, sides: [${s.sides
            .map(side => `{ pocket: '${side.pocket}', stand: { x: ${side.stand.x}, z: ${side.stand.z} } }`)
            .join(', ')}] }`);
    // Why: only the pockets a seam touches, since a pocket with no crossing out of it is somewhere this quest can neither reach nor leave.
    // Why: and never `ardougne`, which is the rest of the map — the navigator owns that side of the palisade, and flooding it would bake a quarter of a million tiles into the module.
    const reached = new Set(seams.flatMap(s => s.sides.map(side => side.pocket)));
    const pocketRows = components
        .filter(c => reached.has(c.name) && c.name !== 'ardougne')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `    { name: '${c.name}', spans: [${spansOf(c.tiles).map(([z, x0, x1]) => `[${z},${x0},${x1}]`).join(',')}] }`);
    fs.writeFileSync(
        OUT,
        [
            '// GENERATED by tools/nav/regicide-pockets.ts — do not edit.',
            '// Regenerate: bun tools/nav/regicide-pockets.ts --bake',
            "import type { RegicidePocket, RegicideSeam } from './pockets.js';",
            '',
            'export const REGICIDE_SEAMS: readonly RegicideSeam[] = [',
            rows.join(',\n'),
            '];',
            '',
            'export const REGICIDE_POCKETS: readonly RegicidePocket[] = [',
            pocketRows.join(',\n'),
            '];',
            ''
        ].join('\n')
    );
    console.log(`\nbaked ${seams.length} seams and ${pocketRows.length} pockets to ${OUT}`);
}
