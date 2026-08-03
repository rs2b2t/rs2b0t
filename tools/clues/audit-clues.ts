import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { CLUE_GATES } from '#/bot/clues/data/clueGates.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from '../nav/lib.js';

const SEARCH_OPS = ['search', 'open'];
const NPC_LEASH = 10;
const GUARDIANS = new Set(['Zamorak Wizard', 'Saradomin Wizard']);
const STARTS: NavPoint[] = [
    { x: 3253, z: 3420, level: 0 },
    { x: 2725, z: 3491, level: 0 }
];

const AUDIT_BUDGET = 600_000;

/**
 * Clue destinations the baked pack cannot route to. Each is a gap in the nav
 * data, not in the clue database: the solver abandons cleanly, and fixing one
 * is a transports/doors change that will make the clue start working with no
 * solver edit. Diagnosed by flood-filling the destination's component and
 * looking for the loc that should bridge it.
 *
 * @see docs/CLUES.md#clues-the-pack-cannot-reach
 */
const KNOWN_UNREACHABLE = new Map<number, string>([
    [2811, 'Baxtorian Falls ledge'],
    [2815, 'Crandor'],
    // Pre-existing: Sinclair Mansion upstairs is a pocket the ladder edge misses.
    [2855, 'Sinclair Mansion upstairs pocket (2745,3576,1)'],
    [2722, 'fenced compound at (3293..3325, 3493..3517) has no baked entrance'],
    [2776, 'Varrock sewer sections are split by double gates derive-doors does not emit (3191/3192,9825)'],
    [2790, 'west Varrock sewer is behind a slashable Web at (3210,9898); nav does not model webs'],
    [3522, 'West Ardougne (2433..2556, 3266..3334) has no baked entrance'],
    [3526, 'island at (2833..2916, 3654..3711) has no baked entrance'],
    [3528, 'island at (2833..2916, 3654..3711) has no baked entrance'],
    [3532, 'south Karamja (2757..2974, 2881..2946) has no baked entrance'],
    [3534, 'south Karamja (2757..2974, 2881..2946) has no baked entrance'],
    [3536, 'south Karamja (2757..2974, 2881..2946) has no baked entrance'],
    [3542, 'Mort Myre islet reached by the Bridge jump at (3440,3331), not baked'],
    [3546, 'islet reached by the Rock Jump-From at (2531,3029), not baked'],
    [3548, 'pocket reached by the Ladder at (2575,3029), not baked'],
    [3552, 'Kharidian desert entry consumes a bought Shantay pass (state-aware crossing)'],
    [3554, 'Kharidian desert entry consumes a bought Shantay pass (state-aware crossing)'],
    [3560, 'Isafdar — requires Regicide'],
    [3562, 'Isafdar — requires Regicide'],
    [3564, 'elf camp — requires Regicide'],
    [3572, 'the ladder at (2701,3408) lands on a 1-tile pocket at level 1'],
    [3579, 'region at (2802..2878, 3329..3393) has no baked entrance']
]);

export interface ClueAuditFinding {
    id: number;
    obj: string;
    type: string;
    problem: string;
}

export interface ClueAuditResult {
    total: number;
    findings: ClueAuditFinding[];
    expectedAbandon: number[];
    clean: number;
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

export function runClueAudit(opts: ClueAuditOptions = {}, log: (m: string) => void = () => {}): ClueAuditResult {
    const o = defaults(opts);
    const finder = loadPack(o.pack);
    const opLocs = loadOpLocs(o.engine);
    const spawns = loadNpcSpawns(o.content);
    const findings: ClueAuditFinding[] = [];
    const expectedAbandon = new Set<number>();

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

    const navProblem = (coord: NavPoint, slack: 'interact' | 'cheb1' | 'cheb2'): { msg: string; unreachable: boolean } | null => {
        for (const start of STARTS) {
            const r = finder.findPath(start, coord, undefined, AUDIT_BUDGET);
            if (!r.ok) {
                return { msg: `no path from (${start.x},${start.z}): ${r.reason}`, unreachable: true };
            }
            const last = r.waypoints[r.waypoints.length - 1];
            if (last.level !== coord.level) {
                return { msg: `terminal (${last.x},${last.z},${last.level}) on wrong level (want ${coord.level})`, unreachable: false };
            }
            const d = cheb(last, coord);
            const exact = last.x === coord.x && last.z === coord.z;
            const cardinal = Math.abs(last.x - coord.x) + Math.abs(last.z - coord.z) === 1;
            const near = slack === 'cheb2' ? d <= 2 : slack === 'cheb1' ? d <= 1 : exact || cardinal;
            if (!near && !exact) {
                return { msg: `terminal (${last.x},${last.z}) not ${slack === 'interact' ? 'interact-legal' : `within ${slack}`} of coord (cheb ${d})`, unreachable: false };
            }
            // The bot stands within a tile of the coord, so a terminal with no
            // egress of its own (a walkable-but-sealed gate tile) is fine as
            // long as some neighbouring stand gets home.
            const stands: NavPoint[] = [last];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx !== 0 || dz !== 0) {
                        stands.push({ x: coord.x + dx, z: coord.z + dz, level: coord.level });
                    }
                }
            }
            let back: { home: NavPoint; from: NavPoint } | null = null;
            let firstFail = '';
            for (const stand of stands) {
                const r2 = finder.findPath(stand, start, undefined, AUDIT_BUDGET);
                if (!r2.ok) {
                    firstFail ||= r2.reason;
                    continue;
                }
                const home = r2.waypoints[r2.waypoints.length - 1];
                if (home.level === start.level && cheb(home, start) <= 2) {
                    back = { home, from: stand };
                    break;
                }
                firstFail ||= `ends at (${home.x},${home.z},${home.level})`;
            }
            if (!back) {
                return { msg: `no return path from (${last.x},${last.z},${last.level}) or any adjacent stand: ${firstFail}`, unreachable: true };
            }
        }
        return null;
    };

    for (const [idStr, clue] of Object.entries(CLUE_DB)) {
        const id = Number(idStr);
        const expected = KNOWN_UNREACHABLE.has(id);
        const fail = (problem: string, unreachable = false): void => {
            if (expected && unreachable) {
                expectedAbandon.add(id);
                log(`EXPECTED-ABANDON ${clue.obj} [${id}] ${clue.type}: ${problem}`);
                return;
            }
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
                    fail(`searchable '${loc.name}' is at (${loc.x},${loc.z}), off the clue coord`);
                }
            }
            const nav = navProblem(clue.coord, clue.type === 'search' ? 'interact' : 'cheb1');
            if (nav) {
                fail(nav.msg, nav.unreachable);
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
                fail(nav.msg, nav.unreachable);
            }
            const near = spawns.filter(s => s.display === clue.npc && s.level === anchor.level && cheb(coord, s) <= NPC_LEASH);
            if (near.length === 0) {
                fail(`no '${clue.npc}' spawn within ${NPC_LEASH} of anchor (${anchor.x},${anchor.z},${anchor.level})`);
            }
        }

        if (clue.keyFrom) {
            if (!clue.keyFrom.npc || !Number.isFinite(clue.keyFrom.keyId)) {
                fail(`keyFrom unresolved (${JSON.stringify(clue.keyFrom)})`);
            }
            const anchor = KILL_ANCHORS[id];
            if (!anchor) {
                fail(`kill-for-key has no KILL_ANCHORS entry (killer '${clue.keyFrom.npc}')`);
            } else if (!Number.isInteger(anchor.x) || !Number.isInteger(anchor.z) || !Number.isInteger(anchor.level) || anchor.level < 0 || anchor.level > 3) {
                fail(`kill anchor malformed: (${anchor.x},${anchor.z},${anchor.level})`);
            } else {
                const nav = navProblem({ x: anchor.x, z: anchor.z, level: anchor.level }, 'cheb2');
                if (nav) {
                    fail(`kill anchor ${nav.msg}`, nav.unreachable);
                }
            }
        }
        if (clue.type === 'dig' && /_sextant\d+$/.test(clue.obj) && clue.needsSextant !== true) {
            fail('sextant clue missing needsSextant flag');
        }

        if (clue.guardian !== undefined) {
            if (clue.type !== 'dig') {
                fail(`guardian '${clue.guardian}' on a ${clue.type} clue — only digs spawn one`);
            }
            if (!GUARDIANS.has(clue.guardian)) {
                fail(`unknown guardian '${clue.guardian}' (expected one of ${[...GUARDIANS].join(', ')})`);
            }
        }

        if (clue.puzzle !== undefined) {
            if (clue.type !== 'talk') {
                fail(`puzzle box on a ${clue.type} clue — only talk NPCs hand one over`);
            }
            if (!Number.isInteger(clue.puzzle.id) || clue.puzzle.id <= 0) {
                fail(`puzzle box '${clue.puzzle.obj}' has no obj id`);
            }
        }
    }

    for (const idStr of Object.keys(CLUE_GATES)) {
        const id = Number(idStr);
        if (!CLUE_DB[id]) {
            findings.push({ id, obj: `clue_${id}`, type: '?', problem: `CLUE_GATES[${id}] is not a clue in the database — stale gate` });
        }
    }

    for (const id of KNOWN_UNREACHABLE.keys()) {
        if (expectedAbandon.has(id)) {
            continue;
        }
        const clue = CLUE_DB[id];
        findings.push({
            id,
            obj: clue?.obj ?? `clue_${id}`,
            type: clue?.type ?? '?',
            problem: `allowlisted ${id} produced no nav-unreachable finding — it is now reachable (or audited clean); remove it from KNOWN_UNREACHABLE`
        });
    }

    for (const idStr of Object.keys(KILL_ANCHORS)) {
        const id = Number(idStr);
        const clue = CLUE_DB[id];
        if (!clue?.keyFrom) {
            findings.push({
                id,
                obj: clue?.obj ?? `clue_${id}`,
                type: clue?.type ?? '?',
                problem: `KILL_ANCHORS[${id}] is not a kill-for-key (keyFrom) clue — stale/misplaced anchor`
            });
        }
    }

    const total = Object.keys(CLUE_DB).length;
    const touched = new Set<number>([...expectedAbandon, ...findings.map(f => f.id)]);
    return {
        total,
        findings,
        expectedAbandon: [...expectedAbandon].sort((a, b) => a - b),
        clean: total - touched.size
    };
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
    const { total, findings, expectedAbandon, clean } = runClueAudit(opts, m => console.log(m));
    const failedIds = new Set(findings.map(f => f.id));
    console.log(`\naudited ${total} clues: ${clean} clean, ${expectedAbandon.length} allowlisted (expected-abandon: ${expectedAbandon.join(', ') || 'none'}), ${findings.length} problem(s) across ${failedIds.size} clue(s)`);
    process.exit(findings.length > 0 ? 1 : 0);
}
