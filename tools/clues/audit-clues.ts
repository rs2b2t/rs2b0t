import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import transportsJson from '#/bot/nav/data/transports.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';
import { KILL_ANCHORS } from '#/bot/clues/data/killAnchors.js';
import { TALK_ANCHORS } from '#/bot/clues/data/talkAnchors.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from '../nav/lib.js';

const SEARCH_OPS = ['search', 'open'];
const NPC_LEASH = 10;
const STARTS: NavPoint[] = [
    { x: 3253, z: 3420, level: 0 },
    { x: 2725, z: 3491, level: 0 }
];

const AUDIT_BUDGET = 600_000;

const KNOWN_UNREACHABLE = new Set<number>([2811, 2815]);

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
            const back = finder.findPath(last, start, undefined, AUDIT_BUDGET);
            if (!back.ok) {
                return { msg: `no return path from terminal (${last.x},${last.z},${last.level}): ${back.reason}`, unreachable: true };
            }
            const home = back.waypoints[back.waypoints.length - 1];
            if (home.level !== start.level || cheb(home, start) > 2) {
                return { msg: `return path from (${last.x},${last.z},${last.level}) ends at (${home.x},${home.z},${home.level}), short of (${start.x},${start.z})`, unreachable: false };
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
    }

    for (const id of KNOWN_UNREACHABLE) {
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
