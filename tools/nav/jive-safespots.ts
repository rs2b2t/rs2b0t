/** Derive the safespots and melee anchor of a Jive grind site, which feed sites.ts under scripts/JiveDragons, scripts/JiveDemons and scripts/JiveKBD.
 *  Why: walkable is not reachable and a multi-tile body slides several tiles off its spawn, so the melee-proof set has to come from the collision pack rather than from looking at the map. */

//   bun tools/nav/jive-safespots.ts [--target blue|demon|kbd] [--anywhere] [--content ~/code/rs2b2t-content] [--engine ~/code/rs2b2t-engine]
import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { gunzipSync } from 'fflate';
import CollisionEngine from '#/bot/event/webwalk/rsmod/CollisionEngine.js';
import { changeLandCollision, changeLocCollision, changeRoofCollision } from '#/bot/event/webwalk/rsmod/collision.js';
import { CollisionFlag, CollisionType } from '#/bot/event/webwalk/rsmod/flags.js';
import { canTravel } from '#/bot/event/webwalk/rsmod/StepValidator.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { BLOCK_MAP_SQUARE, LEVELS, MAP_X, MAP_Z, OPEN, REMOVE_ROOFS, Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, packCoord, parseLands } from './lib.js';

const argVal = (flag: string): string | undefined => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
};

export const PACK = 'out/collision.lcnav.gz';
export const MAPS = path.join(argVal('--content') ?? process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content'), 'maps');
export const ENGINE = argVal('--engine') ?? process.env.ENGINE_DIR ?? path.join(homedir(), 'code', 'rs2b2t-engine');

const LEVEL = 0;
const CAST_RANGE = 10;
const GATE_INSIDE = { x: 2923, z: 9803 };
const LADDER_BOTTOM = { x: 2884, z: 9798 };

export interface Target {
    /** The map squares the spawns are read from. */
    squares: string[];
    adult: { id: number; size: number };
    /** A smaller body whose reach the safespots also avoid; `maxrange` falls back to the adult's. */
    baby: { id: number; size: number; maxrange?: number } | null;
    /** What the engine clamps the npc's movement with. */
    maxrange: number;
    // Why: a stand is ranked by how much of one dragon's own wander it sees, and a chase leash of 20 says nothing about where the dragon idles; the Enclave's south stand saw 11% of its dragon and took no kills in twenty minutes.
    /** The npc's own wanderrange when it differs from `maxrange`, for the share a stand sees of each spawn's idle wander. */
    wander?: number;
    // Why: a metal dragon parks at ten tiles and breathes, and the shield with an Antifire dose makes that 0, so the stand need not be melee-proof; only a tile inside an idle wander footprint is out, and the rest rank by what they see.
    /** Rank every reachable tile outside the idle wander footprints, not only the melee-proof ones. */
    anywhere?: boolean;
    /** The tile the site region floods from. */
    inside: { x: number; z: number };
    /** A tile on the wrong side of the gate, whose region a site area must stay out of. */
    outside: { x: number; z: number };
    // Why: the collision pack bakes one wall layer, the walking one, so a `blockrange=no` railing reads as opaque and a pen fought through a fence derives zero safespots. Either field rebuilds the collision from the engine's own loc configs instead.
    /** Loc ids left out of the collision, so a gate the bot opens on the way in reads as passable. */
    openLocs?: number[];
    /** Cast line of sight against projectile blockers, for a target penned behind a fence spells pass through. */
    projectile?: boolean;
    // Why: the anchor-needs-a-safespot rule is a melee guarantee, and a target nothing can melee safely still has casting stands worth deriving; without this the derivation throws and reports nothing at all.
    /** Report the best anchor with whatever flanking it has rather than failing when none has a safespot beside it. */
    meleeOptional?: boolean;
}

/** Whether the target needs collision rebuilt from the engine rather than read off the pack. */
export function needsEngine(target: Target): boolean {
    return target.projectile === true || (target.openLocs?.length ?? 0) > 0;
}

// Why: m45_152 holds the three babies south of z 9792.
// Why: the answer moves with maxrange: at the wanderrange of 4 the winning anchor is (2903, 9806), which borders two adult spawns instead of one.
export const BLUE_DRAGON: Target = { squares: ['m45_153', 'm45_152'], adult: { id: 55, size: 4 }, baby: { id: 52, size: 2 }, maxrange: 6, inside: GATE_INSIDE, outside: LADDER_BOTTOM };
export const BLACK_DEMON: Target = { squares: ['m44_152'], adult: { id: 84, size: 3 }, baby: null, maxrange: 9, inside: GATE_INSIDE, outside: LADDER_BOTTOM };
// Why: the lair's own spiders are ice spiders, wander 10 and clamped at 12; the poison spiders sit in the dungeon by the in-lever, outside this square.
export const KING_BLACK_DRAGON: Target = { squares: ['m42_153'], adult: { id: 50, size: 5 }, baby: { id: 64, size: 1, maxrange: 12 }, maxrange: 20, inside: { x: 2717, z: 9802 }, outside: { x: 3067, z: 10254 } };

// Why: both spawns sit in one room whose walls pin the two bodies into the same box, so a stand that sees one sees the other.
export const BLACK_DRAGON: Target = { squares: ['m44_153'], adult: { id: 54, size: 4 }, baby: null, maxrange: 12, inside: GATE_INSIDE, outside: LADDER_BOTTOM };

/** The double gate in the north wall of the Heroes' Guild pen. */
export const HEROES_GATE = [1557, 1558];
// Why: the lone adult is penned behind railing and spearwall, both `blockrange=no`, so the fight is cast through the fence and the loot walk goes in through the gate.
export const HEROES_BLUE: Target = { squares: ['m45_154'], adult: { id: 55, size: 4 }, baby: null, maxrange: 6, inside: { x: 2892, z: 9908 }, outside: LADDER_BOTTOM, openLocs: HEROES_GATE, projectile: true };

// Why: the Ogre Enclave has no gate, only the guard's teleport, so the region floods from where it drops you at (2588,9410) and the Taverley ladder stands in for a tile on the other side of nothing.
// Why: the six spawns share one cave with ten spiders, six shamans, six chieftains and five greater demons, so the derivation is what says which dragon has a tile none of the rest of it reaches.
export const GUTANOTH_BLUE: Target = { squares: ['m40_147'], adult: { id: 55, size: 4 }, baby: null, maxrange: 6, inside: { x: 2588, z: 9410 }, outside: LADDER_BOTTOM };

// Why: the same cave as GUTANOTH_BLUE, read for its five greater demons instead: size 3 against the dragons' 4, and `maxrange` 8 against their 6.
export const GUTANOTH_DEMON: Target = { squares: ['m40_147'], adult: { id: 83, size: 3 }, baby: null, maxrange: 8, inside: { x: 2588, z: 9410 }, outside: LADDER_BOTTOM, meleeOptional: true };

// Why: the Brimhaven Dungeon has no gate, only Saniboch's teleport in and the exit loc out, so the region floods from a tile south of the pipe and the landing at (2713,9564) is the sealed other side. wanderrange 5, maxrange 20 and attackrange 10, so a stand is melee-proof rather than fire-proof.
// Why: the other kind shares the room, so it rides in the baby slot at its own wanderrange and a camp keeps out of its idle reach as well.
export const IRON_DRAGON: Target = { squares: ['m42_147'], adult: { id: 1591, size: 4 }, baby: { id: 1592, size: 4, maxrange: 5 }, maxrange: 20, wander: 5, inside: { x: 2698, z: 9491 }, outside: { x: 2713, z: 9564 }, meleeOptional: true };
export const STEEL_DRAGON: Target = { squares: ['m42_147'], adult: { id: 1592, size: 4 }, baby: { id: 1591, size: 4, maxrange: 5 }, maxrange: 20, wander: 5, inside: { x: 2698, z: 9491 }, outside: { x: 2713, z: 9564 }, meleeOptional: true };

export const TARGETS: Record<string, Target> = { blue: BLUE_DRAGON, demon: BLACK_DEMON, black: BLACK_DRAGON, kbd: KING_BLACK_DRAGON, heroes: HEROES_BLUE, gutanoth: GUTANOTH_BLUE, gutanothdemon: GUTANOTH_DEMON, iron: IRON_DRAGON, steel: STEEL_DRAGON };

const DX = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ = [1, 0, -1, 0, 1, -1, -1, 1];
const WALL_N = 1, WALL_E = 2, WALL_S = 4, WALL_W = 8;
const PROJ_N = 0x400, PROJ_E = 0x1000, PROJ_S = 0x4000, PROJ_W = 0x10000, PROJ_LOC = 0x20000;

const squareOf = (t: { x: number; z: number }): string => `m${t.x >> 6}_${t.z >> 6}`;

/** Every square the derivation touches: the spawn squares plus the two the floods start from. */
export function squaresFor(target: Target): Set<string> {
    return new Set([...target.squares, squareOf(target.inside), squareOf(target.outside)]);
}

/** The geometry the derivation reads, either off the baked pack or rebuilt from the engine. */
interface Collision {
    walk(x: number, z: number): boolean;
    exit(x: number, z: number): number;
    /** Whether a sight line may step one tile along x, and the same along z. */
    seeX(x: number, z: number, step: number): boolean;
    seeZ(x: number, z: number, step: number): boolean;
}

function packSource(packPath: string): Collision {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const finder = new PathFinder(bytes);
    const walk = (x: number, z: number): boolean => finder.walkable(x, z, LEVEL);
    const wall = (x: number, z: number): number => finder.wallMask(x, z, LEVEL);
    return {
        walk,
        exit: (x, z) => finder.exitMask(x, z, LEVEL),
        seeX: (x, z, s) => (wall(x, z) & (s > 0 ? WALL_E : WALL_W)) === 0 && (wall(x + s, z) & (s > 0 ? WALL_W : WALL_E)) === 0 && walk(x + s, z),
        seeZ: (x, z, s) => (wall(x, z) & (s > 0 ? WALL_N : WALL_S)) === 0 && (wall(x, z + s) & (s > 0 ? WALL_S : WALL_N)) === 0 && walk(x, z + s)
    };
}

function engineSource(target: Target, engineDir: string): Collision {
    const locTypes = loadLocTypes(engineDir).configs;
    const collision = new CollisionEngine();
    const grounds = new Map<number, Uint8Array>();
    const skip = new Set(target.openLocs ?? []);
    const want = squaresFor(target);
    let loaded = 0;
    for (const { mx, mz, land, loc } of loadMapsquares(engineDir)) {
        if (!want.has(`m${mx}_${mz}`)) {
            continue;
        }
        loaded++;
        const ground = new Uint8Array(MAP_X * MAP_Z * LEVELS);
        const lands = parseLands(new Reader(land), ground);
        grounds.set((mx << 8) | mz, ground);
        const ox = mx << 6, oz = mz << 6;
        for (let level = 0; level < LEVELS; level++) {
            for (let x = 0; x < MAP_X; x++) {
                for (let z = 0; z < MAP_Z; z++) {
                    if (x % 7 === 0 && z % 7 === 0) {
                        collision.allocateIfAbsent(ox + x, oz + z, level);
                    }
                    const coord = packCoord(x, z, level);
                    const land = lands[coord]!;
                    if ((land & REMOVE_ROOFS) !== OPEN) {
                        changeRoofCollision(collision, ox + x, oz + z, level, true);
                    }
                    if ((land & BLOCK_MAP_SQUARE) !== BLOCK_MAP_SQUARE) {
                        continue;
                    }
                    const actual = bridgedLevel(lands, coord, x, z, level);
                    if (actual >= 0) {
                        changeLandCollision(collision, ox + x, oz + z, actual, true);
                    }
                }
            }
        }
        forEachLoc(new Reader(loc), ({ locId, x, z, level, coord, shape, angle }) => {
            if (skip.has(locId)) {
                return;
            }
            const actual = bridgedLevel(lands, coord, x, z, level);
            const type = locTypes[locId];
            if (actual < 0 || !type?.blockwalk) {
                return;
            }
            changeLocCollision(collision, shape, angle, type.blockrange, type.length, type.width, type.active, ox + x, oz + z, actual, true);
        });
    }
    if (loaded !== want.size) {
        throw new Error(`${engineDir} holds ${loaded} of the ${want.size} squares this target needs (${[...want].join(', ')})`);
    }
    const hasGround = (x: number, z: number, level: number): boolean => {
        if (level === 0) {
            return true;
        }
        const ground = grounds.get(((x >> 6) << 8) | (z >> 6));
        return ground !== undefined && ground[packCoord(x & 0x3f, z & 0x3f, level)] === 1;
    };
    const flags = (x: number, z: number): number => collision.get(x, z, LEVEL);
    const walk = (x: number, z: number): boolean => (flags(x, z) & CollisionFlag.WALK_BLOCKED) === CollisionFlag.OPEN;
    const seeWalk = {
        seeX: (x: number, z: number, s: number): boolean => canTravel(collision, LEVEL, x, z, s, 0, 1, 0, CollisionType.NORMAL),
        seeZ: (x: number, z: number, s: number): boolean => canTravel(collision, LEVEL, x, z, 0, s, 1, 0, CollisionType.NORMAL)
    };
    const seeProj = {
        seeX: (x: number, z: number, s: number): boolean =>
            (flags(x, z) & (s > 0 ? PROJ_E : PROJ_W)) === 0 && (flags(x + s, z) & (s > 0 ? PROJ_W : PROJ_E)) === 0 && (flags(x + s, z) & PROJ_LOC) === 0,
        seeZ: (x: number, z: number, s: number): boolean =>
            (flags(x, z) & (s > 0 ? PROJ_N : PROJ_S)) === 0 && (flags(x, z + s) & (s > 0 ? PROJ_S : PROJ_N)) === 0 && (flags(x, z + s) & PROJ_LOC) === 0
    };
    return {
        walk,
        exit: (x, z) => {
            let mask = 0;
            for (let dir = 0; dir < 8; dir++) {
                if (canTravel(collision, LEVEL, x, z, DX[dir]!, DZ[dir]!, 1, 0, CollisionType.NORMAL) && hasGround(x + DX[dir]!, z + DZ[dir]!, LEVEL)) {
                    mask |= 1 << dir;
                }
            }
            return mask;
        },
        ...(target.projectile === true ? seeProj : seeWalk)
    };
}

const key = (x: number, z: number): string => `${x},${z}`;
const parse = (k: string): [number, number] => k.split(',').map(Number) as [number, number];
const cheb = (ax: number, az: number, bx: number, bz: number): number => Math.max(Math.abs(ax - bx), Math.abs(az - bz));

export interface Spawn {
    x: number;
    z: number;
    size: number;
    adult: boolean;
}

export interface Wander {
    spawn: Spawn;
    placements: number;
    body: Set<string>;
    threat: Set<string>;
}

export interface Safespot {
    x: number;
    z: number;
    range: number;
    // Why: a stand that sees one corner of the wander area loses the target the moment it slides off that corner, and the ladder then rotates on a dragon that was never out of reach.
    /** Adult body tiles this stand can see inside cast range, out of `adultBodies`. */
    covers: number;
    /** The largest share of one adult's own wander body this stand sees, and which spawn that is. */
    share: number;
    of: { x: number; z: number };
    /** That share for every adult spawn, in `spawns` order. */
    shares: number[];
}

export interface Anchor {
    x: number;
    z: number;
    spawns: number;
    tiles: number;
}

export interface Derivation {
    spawns: Spawn[];
    wanders: Wander[];
    bodies: number;
    adultBodies: number;
    reachable: Set<string>;
    /** Every tile the ladder side of the gate reaches, none of which a site area may hold. */
    outside: Set<string>;
    safespots: Safespot[];
    anchors: Anchor[];
    anchor: Anchor;
    flanking: Safespot[];
}

export function inputsPresent(target = BLUE_DRAGON, maps = MAPS, engineDir = ENGINE): boolean {
    const geometry = needsEngine(target)
        ? fs.existsSync(path.join(engineDir, 'data/pack/server/loc.dat')) && fs.existsSync(path.join(engineDir, 'data/pack/client/config'))
        : fs.existsSync(PACK);
    return geometry && target.squares.every(s => fs.existsSync(path.join(maps, `${s}.jm2`)));
}

/** Read the spawns straight out of the .jm2 NPC sections, so a moved npc shows up as a moved tile. */
export function readSpawns(target = BLUE_DRAGON, maps = MAPS): Spawn[] {
    const spawns: Spawn[] = [];
    for (const square of target.squares) {
        const file = path.join(maps, `${square}.jm2`);
        const parts = /^m(\d+)_(\d+)$/.exec(square);
        if (!parts) throw new Error(`cannot read a map square origin out of ${square}`);
        const ox = Number(parts[1]) * 64, oz = Number(parts[2]) * 64;
        let section = false, found = false;
        for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
            if (line.startsWith('==== ')) {
                section = line.trim() === '==== NPC ====';
                found ||= section;
                continue;
            }
            const row = section ? /^(\d+) (\d+) (\d+): (\d+)\b/.exec(line.trim()) : null;
            if (!row || row[1] !== String(LEVEL)) continue;
            const id = Number(row[4]);
            const adult = id === target.adult.id;
            if (!adult && id !== target.baby?.id) continue;
            spawns.push({ x: ox + Number(row[2]), z: oz + Number(row[3]), size: adult ? target.adult.size : target.baby!.size, adult });
        }
        if (!found) throw new Error(`${file} has no '==== NPC ====' section`);
    }
    if (!spawns.some(s => s.adult)) throw new Error(`no npc ${target.adult.id} spawns in ${target.squares.join(', ')}; check ${maps}`);
    spawns.sort((a, b) => Number(b.adult) - Number(a.adult) || a.x - b.x || a.z - b.z);
    return spawns;
}

export function derive(target = BLUE_DRAGON, packPath = PACK, maps = MAPS, engineDir = ENGINE): Derivation {
    const source = needsEngine(target) ? engineSource(target, engineDir) : packSource(packPath);
    const where = needsEngine(target) ? engineDir : packPath;

    const walk = (x: number, z: number): boolean => source.walk(x, z);
    const exit = (x: number, z: number): number => source.exit(x, z);

    /** Whether a size-N body placed with its south-west corner here stands on solid ground. */
    const fits = (ox: number, oz: number, size: number): boolean => {
        for (let dx = 0; dx < size; dx++) {
            for (let dz = 0; dz < size; dz++) {
                if (!walk(ox + dx, oz + dz)) return false;
            }
        }
        return true;
    };

    // Why: a body only slides when every tile on its leading edge carries the exit flag, so one blocked corner pins the footprint.
    const canSlide = (ox: number, oz: number, size: number, dir: number): boolean => {
        const bit = 1 << dir;
        for (let i = 0; i < size; i++) {
            const x = dir === 1 ? ox + size - 1 : dir === 3 ? ox : ox + i;
            const z = dir === 0 ? oz + size - 1 : dir === 2 ? oz : oz + i;
            if ((exit(x, z) & bit) === 0) return false;
        }
        return true;
    };

    /** Every footprint origin the npc can reach inside `maxrange`, then the tiles it covers and the tiles it can hit from them. */
    const wander = (spawn: Spawn, reachOverride?: number): Wander => {
        const reach = reachOverride ?? (spawn.adult ? target.maxrange : (target.baby?.maxrange ?? target.maxrange));
        const seen = new Set<string>();
        const body = new Set<string>();
        const queue: { x: number; z: number }[] = [];
        // Why: a spawn line is where the npc stands, not proof its own south-west origin fits; the black dragon at (2829,9826) covers rock at (2832,9829) and seeding only that origin drops a dragon that is plainly in the room.
        for (let ox = spawn.x - spawn.size + 1; ox <= spawn.x; ox++) {
            for (let oz = spawn.z - spawn.size + 1; oz <= spawn.z; oz++) {
                if (fits(ox, oz, spawn.size) && !seen.has(key(ox, oz))) {
                    seen.add(key(ox, oz));
                    queue.push({ x: ox, z: oz });
                }
            }
        }
        let placements = 0;
        while (queue.length > 0) {
            const o = queue.pop()!;
            placements++;
            for (let dx = 0; dx < spawn.size; dx++) {
                for (let dz = 0; dz < spawn.size; dz++) body.add(key(o.x + dx, o.z + dz));
            }
            for (let dir = 0; dir < 4; dir++) {
                const nx = o.x + DX[dir]!, nz = o.z + DZ[dir]!;
                if (seen.has(key(nx, nz)) || cheb(nx, nz, spawn.x, spawn.z) > reach) continue;
                if (!canSlide(o.x, o.z, spawn.size, dir) || !fits(nx, nz, spawn.size)) continue;
                seen.add(key(nx, nz));
                queue.push({ x: nx, z: nz });
            }
        }
        const threat = new Set<string>();
        for (const b of body) {
            const [bx, bz] = parse(b);
            const mask = exit(bx, bz);
            for (let dir = 0; dir < 4; dir++) {
                if (mask & (1 << dir)) threat.add(key(bx + DX[dir]!, bz + DZ[dir]!));
            }
        }
        for (const b of body) threat.delete(b);
        return { spawn, placements, body, threat };
    };

    const openX = (x: number, z: number, step: number): boolean => source.seeX(x, z, step);
    const openZ = (x: number, z: number, step: number): boolean => source.seeZ(x, z, step);

    // Why: the engine casts the ray along the longer axis and only shifts the short axis when the scaled fraction rolls over, so a diagonal that looks clear can still enter a rock tile.
    const sees = (x0: number, z0: number, x1: number, z1: number): boolean => {
        const dx = x1 - x0, dz = z1 - z0;
        let x = x0, z = z0;
        if (Math.abs(dx) >= Math.abs(dz)) {
            if (dx === 0) return true;
            const xStep = dx > 0 ? 1 : -1, zStep = dz > 0 ? 1 : -1;
            let scaled = (z0 << 16) + 0x8000;
            const slope = Math.trunc((dz << 16) / Math.abs(dx));
            while (x !== x1) {
                if (!openX(x, z, xStep)) return false;
                x += xStep;
                scaled += slope;
                const next = scaled >> 16;
                if (next !== z) {
                    if (!openZ(x, z, zStep)) return false;
                    z = next;
                }
            }
            return true;
        }
        const xStep = dx > 0 ? 1 : -1, zStep = dz > 0 ? 1 : -1;
        let scaled = (x0 << 16) + 0x8000;
        const slope = Math.trunc((dx << 16) / Math.abs(dz));
        while (z !== z1) {
            if (!openZ(x, z, zStep)) return false;
            z += zStep;
            scaled += slope;
            const next = scaled >> 16;
            if (next !== x) {
                if (!openX(x, z, xStep)) return false;
                x = next;
            }
        }
        return true;
    };

    const spawns = readSpawns(target, maps);
    const wanders = spawns.map(s => wander(s));
    const adults = wanders.filter(w => w.spawn.adult);
    const allBody = new Set<string>();
    const adultBody = new Set<string>();
    const adultThreat = new Set<string>();
    const babyThreat = new Set<string>();
    for (const w of wanders) {
        for (const b of w.body) {
            allBody.add(b);
            if (w.spawn.adult) adultBody.add(b);
        }
        for (const t of w.threat) (w.spawn.adult ? adultThreat : babyThreat).add(t);
    }

    const flood = (from: { x: number; z: number }, what: string): Set<string> => {
        if (!walk(from.x, from.z)) {
            throw new Error(`${what} (${from.x}, ${from.z}) is not walkable in ${where}`);
        }
        const seen = new Set<string>([key(from.x, from.z)]);
        const stack = [from];
        while (stack.length > 0) {
            const t = stack.pop()!;
            const mask = exit(t.x, t.z);
            for (let dir = 0; dir < 8; dir++) {
                if ((mask & (1 << dir)) === 0) continue;
                const nx = t.x + DX[dir]!, nz = t.z + DZ[dir]!;
                if (seen.has(key(nx, nz))) continue;
                seen.add(key(nx, nz));
                stack.push({ x: nx, z: nz });
            }
        }
        return seen;
    };
    const reachable = flood(target.inside, "the gate's inside tile");
    const outside = flood(target.outside, 'the ladder-side tile');
    if (outside.has(key(target.inside.x, target.inside.z))) {
        throw new Error(`the gate at (${target.inside.x}, ${target.inside.z}) is open in ${where}, so the two sides of it cannot be told apart`);
    }
    const homes = adults.map(w => (target.wander === undefined ? w : wander(w.spawn, target.wander)));
    // Why: a camp in the open still keeps out of every idle wander footprint and the tile beside it, the target's and the other kind's alike, since a dragon that wanders adjacent headbutts for fifteen whatever the dose says.
    const idle = new Set<string>();
    for (const h of homes) {
        for (const b of h.body) idle.add(b);
        for (const t of h.threat) idle.add(t);
    }
    for (const w of wanders) {
        if (w.spawn.adult) continue;
        for (const b of w.body) idle.add(b);
        for (const t of w.threat) idle.add(t);
    }
    const safespots: Safespot[] = [];
    for (const k of reachable) {
        if (target.anywhere === true ? idle.has(k) : (allBody.has(k) || adultThreat.has(k) || babyThreat.has(k))) continue;
        const [x, z] = parse(k);
        const seen = new Set<string>();
        let range = Infinity, covers = 0;
        for (const b of adultBody) {
            const [bx, bz] = parse(b);
            const d = cheb(x, z, bx, bz);
            if (d > CAST_RANGE || !sees(x, z, bx, bz)) continue;
            covers++;
            seen.add(b);
            if (d < range) range = d;
        }
        if (range > CAST_RANGE) continue;
        let share = 0, of = { x: 0, z: 0 };
        const shares: number[] = [];
        for (const h of homes) {
            let hit = 0;
            for (const b of h.body) if (seen.has(b)) hit++;
            const frac = h.body.size === 0 ? 0 : hit / h.body.size;
            shares.push(frac);
            if (frac > share) {
                share = frac;
                of = { x: h.spawn.x, z: h.spawn.z };
            }
        }
        safespots.push({ x, z, range, covers, share, of, shares });
    }
    // Why: a target with no wander of its own keeps the old order, which the checked-in derivations are pinned against.
    safespots.sort((a, b) => (target.wander === undefined ? 0 : b.share - a.share) || a.range - b.range || a.x - b.x || a.z - b.z);

    const anchors: Anchor[] = [];
    for (const k of reachable) {
        if (allBody.has(k) || babyThreat.has(k)) continue;
        const [x, z] = parse(k);
        let touchedSpawns = 0, tiles = 0;
        for (const w of adults) {
            let touched = 0;
            for (const b of w.body) {
                const [bx, bz] = parse(b);
                if (cheb(x, z, bx, bz) === 1) touched++;
            }
            if (touched > 0) touchedSpawns++;
            tiles += touched;
        }
        if (touchedSpawns > 0) anchors.push({ x, z, spawns: touchedSpawns, tiles });
    }
    anchors.sort((a, b) => b.spawns - a.spawns || b.tiles - a.tiles || a.x - b.x || a.z - b.z);
    if (anchors.length === 0) {
        throw new Error('no melee anchor survives: every tile bordering an adult is a body tile or inside a baby\'s reach');
    }
    // Why: the anchor is only usable with a safespot to step back onto, and the tile touching the most body is not always the one that has it: in the Heroes' Guild pen the best-touching tiles sit deepest inside the fence, where every retreat is another tile the dragon reaches.
    const spotsNear = (a: Anchor): Safespot[] => safespots.filter(s => cheb(s.x, s.z, a.x, a.z) <= 2);
    const anchor = anchors.find(a => spotsNear(a).length > 0) ?? (target.meleeOptional ? anchors[0]! : undefined);
    if (!anchor) {
        throw new Error(`no safespot within 2 of any of the ${anchors.length} melee anchors, the best being (${anchors[0]!.x}, ${anchors[0]!.z})`);
    }
    const flanking = spotsNear(anchor);
    return { spawns, wanders, bodies: allBody.size, adultBodies: adultBody.size, reachable, outside, safespots, anchors, anchor, flanking };
}

if (import.meta.main) {
    const name = argVal('--target') ?? 'blue';
    const picked = TARGETS[name];
    if (!picked) throw new Error(`--target takes ${Object.keys(TARGETS).join(', ')}, got '${name}'`);
    const target = process.argv.includes('--anywhere') ? { ...picked, anywhere: true } : picked;
    const d = derive(target);
    for (const w of d.wanders) {
        console.log(`${w.spawn.adult ? 'adult' : 'baby '} spawn (${w.spawn.x}, ${w.spawn.z}) size ${w.spawn.size}: ${w.placements} placements, ${w.body.size} body tiles, ${w.threat.size} tiles it can hit`);
    }
    console.log(`bodies ${d.bodies} (${d.adultBodies} adult)`);
    console.log(`${d.reachable.size} tiles reachable from the gate's inside tile (${target.inside.x}, ${target.inside.z}), ${d.outside.size} on the ladder side`);
    console.log(`${d.safespots.length} safespots: reachable, off every body, out of every threat set, and looking at an adult inside ${CAST_RANGE}`);
    for (const s of d.safespots.slice(0, 12)) console.log(`  (${s.x}, ${s.z})  sees an adult ${s.range} away, ${s.covers} of ${d.adultBodies} body tiles, ${Math.round(s.share * 100)}% of the one at (${s.of.x}, ${s.of.z})`);
    const adultSpawns = d.spawns.filter(s => s.adult).length;
    console.log(`${d.anchors.length} melee anchors: off every body, out of every baby's reach, touching an adult at range 1`);
    for (const a of d.anchors) console.log(`  (${a.x}, ${a.z})  ${a.spawns} of ${adultSpawns} adult spawns, ${a.tiles} body tiles at range 1`);
    console.log(`melee anchor (${d.anchor.x}, ${d.anchor.z})`);
    console.log(`safespots within 2 of it: ${d.flanking.map(s => `(${s.x}, ${s.z})`).join(' ')}`);
}
