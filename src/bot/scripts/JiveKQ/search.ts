import { inLair, near, type Phase, type Point } from './policy.js';

export interface QueenSighting { id: number; tile: Point; at: number; engaged: boolean }
const WAYPOINTS = [[3488, 9496], [3472, 9508], [3496, 9512], [3506, 9492], [3486, 9484], [3470, 9488]].map(([x, z]) => ({ x, z, level: 0 }));
const distance = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export function approachQueen(queen: Point, from: Point, usable: (p: Point) => boolean): Point | null {
    const tiles: Point[] = [];
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
        if (Math.max(Math.abs(x), Math.abs(z)) === 6) tiles.push({ ...queen, x: queen.x + x, z: queen.z + z });
    }
    return tiles.sort((a, b) => distance(a, from) - distance(b, from)).find(p => inLair(p) && usable(p)) ?? null;
}

export function pullQueen(queen: Point, phase: Phase, cross: (p: Point) => boolean, step: (from: Point, to: Point) => boolean, usable: (p: Point) => boolean, attempt = 0): Point | null {
    const candidates: Point[] = [];
    for (const [dx, dz] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        let from = queen;
        for (let n = 1; n <= 8; n++) {
            const to = { ...queen, x: queen.x + dx * n, z: queen.z + dz * n };
            if (!step(from, to)) break;
            from = to;
            const range = phase === 'melee' ? 18 : 13;
            const target = { ...to, x: to.x + dx * range, z: to.z + dz * range };
            if (cross(to) && inLair(target) && usable(target)) { candidates.push(target); break; }
        }
    }
    return candidates.length ? candidates[attempt % candidates.length] : null;
}

export class QueenSearch {
    private index = 0;
    private target: Point | null = null;
    private since = 0;
    private visitedAt = 0;

    next(here: Point, sighting: QueenSighting | null, now: number, usable: (p: Point) => boolean): Point | null {
        if (sighting && now - sighting.at <= 8000 && sighting.at > this.visitedAt) {
            const target = approachQueen(sighting.tile, here, usable);
            if (target && !near(here, target, 1)) return target;
            this.visitedAt = sighting.at;
        }
        for (let n = 0; n < WAYPOINTS.length; n++) {
            if (this.target && (near(here, this.target, 2) || now - this.since > 8000)) {
                this.index = (this.index + 1) % WAYPOINTS.length;
                this.target = null;
            }
            if (!this.target) {
                const anchor = WAYPOINTS[this.index];
                for (let radius = 0; radius <= 3 && !this.target; radius++) {
                    for (let x = -radius; x <= radius && !this.target; x++) for (let z = -radius; z <= radius; z++) {
                        const p = { ...anchor, x: anchor.x + x, z: anchor.z + z };
                        if (usable(p)) { this.target = p; this.since = now; break; }
                    }
                }
            }
            if (this.target && !near(here, this.target, 2)) return this.target;
            this.index = (this.index + 1) % WAYPOINTS.length;
            this.target = null;
        }
        return null;
    }
}
