/** Seam graph of Tirannwn and the routes between Regicide's landmarks. */

// Why: Tirannwn has about 24 pockets joined by scripted crossings; derive their connections from the map.
// Why: use stands around each loc; tripwires and pitfalls have different landing offsets.
// Why: dense forest needs %regicide_quest >= ^regicide_spoken_tracker2; emit routes for both quest stages.

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

/** Quest stand tiles used to name discovered pockets. */
const LANDMARKS: [string, NavPoint][] = [
    // Why: the Arandar palisade is missing from doors.json; name both sides of this only connection to the mainland.
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

// Why: offline findPath ignores quest gates and can merge both sides of the Arandar palisade.
const STEP_DIRS = [
    [0, 1, 0x1],
    [1, 0, 0x2],
    [0, -1, 0x4],
    [-1, 0, 0x8]
] as const;
/** Backstop for the mainland flood, which is the rest of the map. */
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

// Why: pockets include ordinary doors and shortcuts, but exclude crossings handled by the quest.
// Why: derived log-balance edges must be excluded too; the live walker leaves them to the quest.
const components: { name: string; rep: NavPoint; tiles: Set<number> }[] = [];
const cache = new Map<number, string | null>();

// Why: Arandar is missing from doors.json; pin both sides with a walk-only flood so pathfinding cannot merge them.
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
    /** True when the loc only works from `sides[0]`; pitfalls and log balances are one-way. */
    directed?: boolean;
}

// Why: pitfall side locs and log starts only work from their own bank; clicking the far pitfall loc stages the player inside the pit.
const DIRECTED = new Set(['pit', 'log']);

const at = (x: number, z: number): NavPoint => ({ x, z, level: 0 });

/** Every `regicide_pitfall_mid` placement; tells a side loc which way it faces. */
const PIT_MIDS: NavPoint[] = [];
/** Every log balance start; each one finds the bank its partner stands on. */
const LOG_STARTS: { locId: number; x: number; z: number }[] = [];

function pitMid(x: number, z: number): NavPoint | null {
    return PIT_MIDS.find(mid => Math.abs(mid.x - x) + Math.abs(mid.z - z) === 1) ?? null;
}

// Why: the far plank only exits onto the log; using it as a stand splits one crossing across different pockets.
const MIN_STAND_TILES = 4;

/** First tile with a walkable exit, searching outwards from (x,z). */
function firstWalkable(x: number, z: number, dx: number, dz: number, tries = 4): NavPoint | null {
    for (let step = 0; step < tries; step++) {
        const tile = at(x + dx * step, z + dz * step);
        if (finder.exitMask(tile.x, tile.z, 0) !== 0 && flood(tile).size >= MIN_STAND_TILES) {
            return tile;
        }
    }
    return null;
}

/** Find landing tiles from the crossing script.
 * Why: nearby dense-forest crossings are only three tiles apart; a broad ring search mixes them up. */
function sidesOf(locId: number, x: number, z: number, angle: number, name: string): [NavPoint, NavPoint] | null {
    const acrossX = angle === 1 || angle === 3;
    if (SEAM_LOCS.get(locId)?.kind === 'forest') {
        // `_regicide_cross_over`: $start and $dest, one tile off each end of the 3x2 footprint.
        return acrossX ? [at(x - 1, z + 1), at(x + 2, z + 1)] : [at(x + 1, z - 1), at(x + 1, z + 2)];
    }
    if (name.startsWith('regicide_logbalance')) {
        // `regicide_logbalance`: loc_coord, then +/-1, +/-2, +/-2, 5 tiles out away from the centre.
        // Why: the log and landing are isolated from the banks in the collision pack; scan outwards from each start loc.
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
        // `regicide_jump_pitfall`: staged 1 tile off the side loc on your own side, landed 3 past it. The side comes from where the loc sits around its pit; a side loc is only taken from the bank it faces.
        const mid = pitMid(x, z);
        if (mid === null) {
            return null;
        }
        const dx = x - mid.x;
        const dz = z - mid.z;
        return [at(x + dx, z + dz), at(x - dx * 3, z - dz * 3)];
    }
    if (name === 'regicide_trap_tripwire') {
        // `oploc1,regicide_trap_tripwire`: 3 net tiles from the stand, over a 1x2 footprint.
        return acrossX ? [at(x + 2, z), at(x - 1, z)] : [at(x, z + 2), at(x, z - 1)];
    }
    if (name.startsWith('overpass_gate')) {
        // `arandar_gate`: 2 tiles north or south of the click, from beside the palisade.
        return [at(x, z - 1), at(x, z + 1)];
    }
    if (name === 'regicide_trap_woodspring') {
        // `oploc1,regicide_trap_woodspring`: 1 tile off each end of the 3x1 footprint.
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

/** Encode pocket tiles as [z, xStart, xEnd] runs.
 * Why: large pockets exceed the loaded scene; runtime membership needs the baked tile set. */
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
    // Only include pockets connected by a crossing.
    // Why: the navigator handles ardougne; baking the mainland adds 250,000 unnecessary tiles.
    const reached = new Set(seams.flatMap(s => s.sides.map(side => side.pocket)));
    const pocketRows = components
        .filter(c => reached.has(c.name) && c.name !== 'ardougne')
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `    { name: '${c.name}', spans: [${spansOf(c.tiles).map(([z, x0, x1]) => `[${z},${x0},${x1}]`).join(',')}] }`);
    fs.writeFileSync(
        OUT,
        [
            '// GENERATED by tools/nav/regicide-pockets.ts, do not edit.',
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
