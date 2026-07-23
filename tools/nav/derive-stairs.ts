import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';

import { Reader, bridgedLevel, forEachLoc, loadLocTypes, loadMapsquares, parseLands } from './lib.js';
import { parseSwitchStairs } from './stairsParse.js';

function argVal(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
}

const engine = argVal('--engine') ?? process.env.ENGINE_DIR ?? path.join(homedir(), 'code', 'rs2b2t-engine');
const content = argVal('--content') ?? process.env.CONTENT_DIR ?? path.join(homedir(), 'code', 'rs2b2t-content');
const out = argVal('--out') ?? 'src/bot/nav/data/stairEdges.json';
const packPath = argVal('--pack') ?? 'out/collision.lcnav.gz';

const LADDER_LOC_IDS = new Set([1746, 1747, 1748, 1749, 1750]);

function edge(from: NavPoint, to: NavPoint, locName: string, action: string): TransportEdgeData {
    return { from, to, locName, action, kind: 'stair' };
}

function offsets(R: number): [number, number][] {
    const o: [number, number][] = [];
    for (let dx = -R; dx <= R; dx++) {
        for (let dz = -R; dz <= R; dz++) {
            o.push([dx, dz]);
        }
    }
    o.sort((a, b) => {
        const ca = Math.max(Math.abs(a[0]), Math.abs(a[1]));
        const cb = Math.max(Math.abs(b[0]), Math.abs(b[1]));
        if (ca !== cb) return ca - cb;
        const ma = Math.abs(a[0]) + Math.abs(a[1]);
        const mb = Math.abs(b[0]) + Math.abs(b[1]);
        if (ma !== mb) return ma - mb;
        if (a[1] !== b[1]) return b[1] - a[1];
        return a[0] - b[0];
    });
    return o;
}
const SNAP_OFFSETS = offsets(2);

function reverseAction(action: string): string {
    if (/-down/i.test(action)) return action.replace(/-down/i, '-up');
    if (/-up/i.test(action)) return action.replace(/-up/i, '-down');
    return action;
}

function snapWalkable(finder: PathFinder, x: number, z: number, level: number): NavPoint | null {
    for (const [dx, dz] of SNAP_OFFSETS) {
        if (finder.walkable(x + dx, z + dz, level)) return { x: x + dx, z: z + dz, level };
    }
    return null;
}

function pivotBoth(finder: PathFinder, x: number, z: number, a: number, b: number): { x: number; z: number } | null {
    for (const [dx, dz] of SNAP_OFFSETS) {
        if (finder.walkable(x + dx, z + dz, a) && finder.walkable(x + dx, z + dz, b)) return { x: x + dx, z: z + dz };
    }
    return null;
}

function snapAndReverse(finder: PathFinder, curated: TransportEdgeData[], raw: TransportEdgeData[]): { edges: TransportEdgeData[]; dropped: number; supersededDropped: number } {
    const snapped: TransportEdgeData[] = [];
    let dropped = 0;
    for (const e of raw) {
        let f: NavPoint | null;
        let t: NavPoint | null;
        if (e.from.x === e.to.x && e.from.z === e.to.z) {
            const piv = pivotBoth(finder, e.from.x, e.from.z, e.from.level, e.to.level);
            f = piv ? { x: piv.x, z: piv.z, level: e.from.level } : null;
            t = piv ? { x: piv.x, z: piv.z, level: e.to.level } : null;
        } else {
            f = snapWalkable(finder, e.from.x, e.from.z, e.from.level);
            t = snapWalkable(finder, e.to.x, e.to.z, e.to.level);
        }
        if (!f || !t) {
            dropped++;
            continue;
        }
        snapped.push({ ...e, from: f, to: t });
    }
    const seen = new Set<string>();
    const edges: TransportEdgeData[] = [];
    const key = (e: TransportEdgeData): string => `${e.from.x},${e.from.z},${e.from.level}>${e.to.x},${e.to.z},${e.to.level}`;
    const add = (e: TransportEdgeData): void => {
        const k = key(e);
        if (!seen.has(k)) {
            seen.add(k);
            edges.push(e);
        }
    };
    for (const e of snapped) {
        add(e);
    }
    for (const e of snapped) {
        if (e.from.level !== e.to.level && /-(up|down)/i.test(e.action)) {
            add({ from: e.to, to: e.from, locName: e.locName, action: reverseAction(e.action), kind: e.kind });
        }
    }

    const tileKey = (p: NavPoint): string => `${p.x},${p.z},${p.level}`;
    const curatedFromsByDest = new Map<string, Set<string>>();
    for (const c of curated) {
        if (c.from.level === c.to.level) {
            continue;
        }
        const dk = tileKey(c.to);
        let froms = curatedFromsByDest.get(dk);
        if (!froms) {
            froms = new Set<string>();
            curatedFromsByDest.set(dk, froms);
        }
        froms.add(tileKey(c.from));
    }
    let supersededDropped = 0;
    const kept = edges.filter(e => {
        const froms = curatedFromsByDest.get(tileKey(e.to));
        if (froms && !froms.has(tileKey(e.from))) {
            supersededDropped++;
            return false;
        }
        return true;
    });
    return { edges: kept, dropped, supersededDropped };
}

function main(): void {
    const { configs } = loadLocTypes(engine);
    const edges: TransportEdgeData[] = [];

    const byDebug = new Map<string, (typeof configs)[number]>();
    for (const c of configs) {
        if (c.debugname) {
            byDebug.set(c.debugname, c);
        }
    }
    const stairsText = fs.readFileSync(path.join(content, 'scripts/ladders+stairs/scripts/stairs.rs2'), 'utf8');
    let stairsCases = 0;
    let stairsSkipped = 0;
    for (const s of parseSwitchStairs(stairsText)) {
        const def = byDebug.get(s.debugname);
        const action = def?.op?.[s.op - 1];
        if (!def || !action) {
            stairsSkipped++;
            continue;
        }
        edges.push(edge(s.from, s.to, def.name ?? s.debugname, action));
        stairsCases++;
    }

    let ladderEdges = 0;
    for (const { mx, mz, land, loc } of loadMapsquares(engine)) {
        const baseX = mx << 6;
        const baseZ = mz << 6;
        const lands = parseLands(new Reader(land));
        forEachLoc(new Reader(loc), inst => {
            if (!LADDER_LOC_IDS.has(inst.locId)) {
                return;
            }
            const def = configs[inst.locId];
            if (!def?.op) {
                return;
            }
            const level = bridgedLevel(lands, inst.coord, inst.x, inst.z, inst.level);
            if (level < 0) {
                return;
            }
            const here: NavPoint = { x: baseX + inst.x, z: baseZ + inst.z, level };
            for (const op of def.op) {
                if (!op) {
                    continue;
                }
                if (/climb-up/i.test(op)) {
                    edges.push(edge(here, { ...here, level: level + 1 }, def.name ?? 'Ladder', op));
                    ladderEdges++;
                } else if (/climb-down/i.test(op) && level > 0) {
                    edges.push(edge(here, { ...here, level: level - 1 }, def.name ?? 'Ladder', op));
                    ladderEdges++;
                }
            }
        });
    }

    let packBytes: Uint8Array = new Uint8Array(fs.readFileSync(packPath));
    if (packBytes[0] === 0x1f && packBytes[1] === 0x8b) {
        packBytes = gunzipSync(packBytes);
    }
    const finder = new PathFinder(packBytes);
    const dataDir = path.join('src', 'bot', 'nav', 'data');
    const curatedTransports = JSON.parse(fs.readFileSync(path.join(dataDir, 'transports.json'), 'utf8')) as TransportEdgeData[];
    const rawCount = edges.length;
    const { edges: finalEdges, dropped, supersededDropped } = snapAndReverse(finder, curatedTransports, edges);

    finalEdges.sort((a, b) => a.from.level - b.from.level || a.from.x - b.from.x || a.from.z - b.from.z || a.to.level - b.to.level || a.to.x - b.to.x || a.to.z - b.to.z);

    const json = '[\n' + finalEdges.map(e => '    ' + JSON.stringify(e)).join(',\n') + '\n]\n';

    const stats = `${finalEdges.length} edges (${rawCount} raw = ${stairsCases} stairs.rs2 + ${ladderEdges} generic-ladder, ${stairsSkipped} unresolved; ${dropped} unsnappable dropped; ${supersededDropped} curated-superseded dropped; snapped + reversed)`;
    if (process.argv.includes('--check')) {
        const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
        if (current !== json) {
            console.error(`STALE: ${out} — run bun tools/nav/derive-stairs.ts`);
            process.exitCode = 1;
        } else {
            console.log(`ok: ${out} matches — ${stats}`);
        }
    } else {
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, json);
        console.log(`wrote ${out}: ${stats}`);
    }

    const cheb = (p: NavPoint, x: number, z: number): number => Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
    const expect: { name: string; fl: number; tl: number; x: number; z: number }[] = [
        { name: 'Lumbridge Castle South (stairs.rs2)', fl: 0, tl: 1, x: 3205, z: 3209 },
        { name: 'Varrock East bank (stairs.rs2)', fl: 0, tl: 1, x: 3255, z: 3420 },
        { name: 'Lumbridge tower ladder (1747)', fl: 0, tl: 1, x: 3229, z: 3213 },
        { name: 'Catherby ladder (1747)', fl: 0, tl: 1, x: 2807, z: 3454 }
    ];
    let failures = 0;
    for (const e of expect) {
        const hit = finalEdges.some(x => x.from.level === e.fl && x.to.level === e.tl && cheb(x.from, e.x, e.z) <= 3 && cheb(x.to, e.x, e.z) <= 3 && finder.walkable(x.from.x, x.from.z, x.from.level) && finder.walkable(x.to.x, x.to.z, x.to.level));
        console.log(`${hit ? 'PASS' : 'FAIL'} ${e.name} — walkable ${e.fl}->${e.tl} edge near ${e.x},${e.z}`);
        if (!hit) {
            failures++;
        }
    }
    if (failures > 0) {
        process.exitCode = 1;
    }
}

main();
