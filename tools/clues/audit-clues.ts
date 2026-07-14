/**
 * Offline audit of EVERY clue variant in CLUE_DB against the real collision
 * pack + engine map data — catches each abandonment class the solver has hit
 * live, without a game session:
 *
 *   search — a searchable loc (Search/Open op, pickSearchLoc semantics) exists
 *            within 1 tile of the clue coord at its level, AND the pathfinder
 *            terminal from BOTH solver banks is interact-legal (exact tile, or
 *            cardinally adjacent with no wall between — the Varrock diagonal-
 *            door house and Seers drawers bugs).
 *   dig    — the coord is standable-or-adjacent: terminal within Chebyshev 1
 *            on the right level (spade dig checks distance<=1).
 *   talk   — a TALK_ANCHORS entry exists, the anchor is pathable (terminal
 *            within 2), and an NPC spawn with the clue's display name sits
 *            within NPC_LEASH of the anchor at its level (content maps'
 *            `==== NPC ====` sections).
 *
 * Usage: bun tools/clues/audit-clues.ts [--engine <dir>] [--content <dir>]
 *                                       [--pack <file>]
 * Exit 1 when any clue fails. The pack-gated bun test
 * (test/clues/clue-audit.test.ts) runs the same audit and pins it to zero
 * failures, so a nav-data or cluedb regression surfaces before a live abandon.
 */
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from '../nav/lib.js';

// mirror the executor's constants (ClueExecutor.ts)
const SEARCH_OPS = ['search', 'open'];
const NPC_LEASH = 10;
// both banks a solver realistically starts a leg from (RockCrab banks Seers,
// ClueSolver nearest-bank; Varrock East covers the eastern half)
const STARTS: NavPoint[] = [
    { x: 3253, z: 3420, level: 0 }, // Varrock East bank
    { x: 2725, z: 3491, level: 0 } // Seers bank
];

export interface ClueAuditFinding {
    id: number;
    obj: string;
    type: string;
    problem: string;
}

export interface ClueAuditOptions {
    engine?: string;
    content?: string;
    pack?: string;
}

interface LocAt {
    x: number;
    z: number;
    level: number;
    name: string;
    ops: string[];
}

interface NpcSpawn {
    x: number;
    z: number;
    level: number;
    display: string;
}

function defaults(opts: ClueAuditOptions): Required<ClueAuditOptions> {
    return {
        engine: opts.engine ?? join(homedir(), 'code', 'lostcity-dev', 'engine'),
        content: opts.content ?? process.env.CONTENT_DIR ?? join(homedir(), 'code', 'rs2b2t-content'),
        pack: opts.pack ?? 'out/collision.lcnav.gz'
    };
}

/** All the audit's inputs exist on this machine (the bun test's skip gate). */
export function auditInputsPresent(opts: ClueAuditOptions = {}): boolean {
    const o = defaults(opts);
    return fs.existsSync(o.pack) && fs.existsSync(o.engine) && fs.existsSync(join(o.content, 'maps'));
}

function loadPack(pack: string): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(pack));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const finder = new PathFinder(bytes);
    finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as TransportEdgeData[], stairsJson as TransportEdgeData[]);
    return finder;
}

/** Every loc instance with at least one op, keyed by world tile. */
function loadOpLocs(engine: string): Map<string, LocAt[]> {
    const { configs } = loadLocTypes(engine);
    const locs = new Map<string, LocAt[]>();
    for (const { mx, mz, land, loc } of loadMapsquares(engine)) {
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));
        forEachLoc(new Reader(loc), instance => {
            const type = configs[instance.locId];
            const ops = (type?.op ?? []).filter((op): op is string => op != null);
            if (ops.length === 0) {
                return;
            }
            const level = bridgedLevel(lands, instance.coord, instance.x, instance.z, instance.level);
            if (level < 0) {
                return;
            }
            const at: LocAt = { x: baseX + instance.x, z: baseZ + instance.z, level, name: type.name ?? type.debugname ?? `loc_${instance.locId}`, ops };
            const key = `${at.x}|${at.z}|${at.level}`;
            const list = locs.get(key);
            if (list) {
                list.push(at);
            } else {
                locs.set(key, [at]);
            }
        });
    }
    return locs;
}

/** NPC spawns with display names, from the content maps' `==== NPC ====`
 *  sections (`level lx lz: npcId`) + pack/npc.pack ids + .npc config names. */
function loadNpcSpawns(content: string): NpcSpawn[] {
    const idToDebug = new Map<number, string>();
    for (const raw of fs.readFileSync(join(content, 'pack', 'npc.pack'), 'utf8').split('\n')) {
        const m = /^(\d+)=(\S+)$/.exec(raw.trim());
        if (m) {
            idToDebug.set(Number(m[1]), m[2]);
        }
    }

    const debugToDisplay = new Map<string, string>();
    const files = (fs.readdirSync(join(content, 'scripts'), { recursive: true }) as string[]).filter(f => f.endsWith('.npc')).sort();
    // canonical configs win over the _unpack decompiled dumps (gen-cluedb.ts)
    for (const f of [...files.filter(f => f.includes('_unpack')), ...files.filter(f => !f.includes('_unpack'))]) {
        let cur: string | null = null;
        for (const raw of fs.readFileSync(join(content, 'scripts', f), 'utf8').split('\n')) {
            const line = raw.trim();
            const head = /^\[([a-z0-9_]+)\]$/.exec(line);
            if (head) {
                cur = head[1];
            } else if (cur && line.startsWith('name=')) {
                debugToDisplay.set(cur, line.slice('name='.length));
            }
        }
    }

    const spawns: NpcSpawn[] = [];
    for (const file of fs.readdirSync(join(content, 'maps'))) {
        const m = /^m(\d+)_(\d+)\.jm2$/.exec(file);
        if (!m) {
            continue;
        }
        const baseX = Number(m[1]) << 6;
        const baseZ = Number(m[2]) << 6;
        const text = fs.readFileSync(join(content, 'maps', file), 'utf8');
        const section = /^==== NPC ====$([\s\S]*?)(?=^==== |\n?$(?![\s\S]))/m.exec(text);
        if (!section) {
            continue;
        }
        for (const raw of section[1].split('\n')) {
            const spawn = /^(\d) (\d+) (\d+): (\d+)$/.exec(raw.trim());
            if (!spawn) {
                continue;
            }
            const display = debugToDisplay.get(idToDebug.get(Number(spawn[4])) ?? '');
            if (display) {
                spawns.push({ level: Number(spawn[1]), x: baseX + Number(spawn[2]), z: baseZ + Number(spawn[3]), display });
            }
        }
    }
    return spawns;
}

const cheb = (a: NavPoint, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export function runClueAudit(opts: ClueAuditOptions = {}, log: (m: string) => void = () => {}): ClueAuditFinding[] {
    const o = defaults(opts);
    const finder = loadPack(o.pack);
    const opLocs = loadOpLocs(o.engine);
    const spawns = loadNpcSpawns(o.content);
    const findings: ClueAuditFinding[] = [];

    /** pickSearchLoc semantics: nearest op-loc within 1 tile of coord offering
     *  a search-style op. */
    const searchableAt = (coord: NavPoint): LocAt | null => {
        let best: { at: LocAt; dist: number } | null = null;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
                for (const at of opLocs.get(`${coord.x + dx}|${coord.z + dz}|${coord.level}`) ?? []) {
                    if (!at.ops.some(op => SEARCH_OPS.includes(op.toLowerCase()))) {
                        continue;
                    }
                    const dist = Math.max(Math.abs(dx), Math.abs(dz));
                    if (!best || dist < best.dist) {
                        best = { at, dist };
                    }
                }
            }
        }
        return best?.at ?? null;
    };

    /** A terminal the executor can actually act from: exact tile, or cardinal-
     *  adjacent with no wall on the terminal's edge facing the coord. `slack`
     *  loosens to plain Chebyshev for dig (held op, no interact reach). */
    const navProblem = (coord: NavPoint, slack: 'interact' | 'cheb1' | 'cheb2'): string | null => {
        for (const start of STARTS) {
            const r = finder.findPath(start, coord);
            if (!r.ok) {
                return `no path from (${start.x},${start.z}): ${r.reason}`;
            }
            const last = r.waypoints[r.waypoints.length - 1];
            if (last.level !== coord.level) {
                return `terminal (${last.x},${last.z},${last.level}) on wrong level (want ${coord.level})`;
            }
            const d = cheb(last, coord);
            const exact = last.x === coord.x && last.z === coord.z;
            const cardinal = Math.abs(last.x - coord.x) + Math.abs(last.z - coord.z) === 1;
            const near = slack === 'cheb2' ? d <= 2 : slack === 'cheb1' ? d <= 1 : exact || cardinal;
            if (!near && !exact) {
                return `terminal (${last.x},${last.z}) not ${slack === 'interact' ? 'interact-legal' : `within ${slack}`} of coord (cheb ${d})`;
            }
            // egress: the solver walks OUT afterwards (next leg / bank) from
            // where it stood — a one-way crossing (missing reverse edge) would
            // strand it there
            const back = finder.findPath(last, start);
            if (!back.ok) {
                return `no return path from terminal (${last.x},${last.z},${last.level}): ${back.reason}`;
            }
            const home = back.waypoints[back.waypoints.length - 1];
            if (home.level !== start.level || cheb(home, start) > 2) {
                return `return path from (${last.x},${last.z},${last.level}) ends at (${home.x},${home.z},${home.level}), short of (${start.x},${start.z})`;
            }
        }
        return null;
    };

    for (const [idStr, clue] of Object.entries(CLUE_DB)) {
        const id = Number(idStr);
        const fail = (problem: string): void => {
            findings.push({ id, obj: clue.obj, type: clue.type, problem });
            log(`FAIL ${clue.obj} [${id}] ${clue.type}: ${problem}`);
        };

        if (clue.type === 'search' || clue.type === 'dig') {
            if (!clue.coord) {
                fail('no coord in cluedb');
                continue;
            }
            if (clue.type === 'search') {
                const loc = searchableAt(clue.coord);
                if (!loc) {
                    fail(`no searchable loc within 1 of (${clue.coord.x},${clue.coord.z},${clue.coord.level})`);
                } else if (loc.x !== clue.coord.x || loc.z !== clue.coord.z) {
                    // the trail script matches loc_coord == trail_coord exactly
                    fail(`searchable '${loc.name}' is at (${loc.x},${loc.z}), off the clue coord`);
                }
            }
            const nav = navProblem(clue.coord, clue.type === 'search' ? 'interact' : 'cheb1');
            if (nav) {
                fail(nav);
            }
        } else if (clue.type === 'talk') {
            const anchor = TALK_ANCHORS[id];
            if (!anchor || !clue.npc) {
                fail(`no anchor/npc for talk clue (npc '${clue.npc ?? '?'}')`);
                continue;
            }
            const coord = { x: anchor.x, z: anchor.z, level: anchor.level };
            const nav = navProblem(coord, 'cheb2');
            if (nav) {
                fail(nav);
            }
            const near = spawns.filter(s => s.display === clue.npc && s.level === anchor.level && cheb(coord, s) <= NPC_LEASH);
            if (near.length === 0) {
                fail(`no '${clue.npc}' spawn within ${NPC_LEASH} of anchor (${anchor.x},${anchor.z},${anchor.level})`);
            }
        }
        // open-casket entries have no world state to audit
    }

    return findings;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const opts: ClueAuditOptions = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--engine') {
            opts.engine = args[++i];
        } else if (args[i] === '--content') {
            opts.content = args[++i];
        } else if (args[i] === '--pack') {
            opts.pack = args[++i];
        } else {
            console.error(`unknown argument: ${args[i]}`);
            process.exit(2);
        }
    }
    if (!auditInputsPresent(opts)) {
        console.error('missing inputs (pack/engine/content) — see file header');
        process.exit(2);
    }
    const findings = runClueAudit(opts, m => console.log(m));
    const total = Object.keys(CLUE_DB).length;
    console.log(`\naudited ${total} clues: ${total - new Set(findings.map(f => f.id)).size} clean, ${findings.length} problem(s) across ${new Set(findings.map(f => f.id)).size} clue(s)`);
    process.exit(findings.length > 0 ? 1 : 0);
}
