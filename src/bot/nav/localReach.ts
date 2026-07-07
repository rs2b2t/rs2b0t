// Scene-local reachability over LIVE collision flags — the same neighbour
// rules as Client.tryMove's BFS (Client.ts:5679-5770): a cardinal step is
// allowed when the destination tile's PL_WALK_<opposite> mask is clear; a
// diagonal additionally needs both adjacent cardinals clear. Pure module —
// callers supply a FlagsAt (usually reader.collisionFlags) so tests can run
// against synthetic grids.

import { CollisionFlag } from '#/dash3d/CollisionFlag.js';

export type FlagsAt = (lx: number, lz: number) => number | null;

export interface LocalPoint {
    lx: number;
    lz: number;
}

export interface ReachOptions {
    /** BFS expansion cap (default 400 — ~a 20x20 neighbourhood). */
    maxSteps?: number;
    /** Success when a tile CARDINALLY adjacent to `to` (with no wall between)
     *  is reached — for NPC targets whose own tile may be flagged. */
    adjacentOk?: boolean;
}

const DEFAULT_MAX_STEPS = 400;

function open(flags: FlagsAt, lx: number, lz: number, mask: number): boolean {
    const f = flags(lx, lz);
    return f !== null && (f & mask) === CollisionFlag._OPEN;
}

/** One-tile step from (lx,lz) by (dx,dz) — dx/dz each in {-1,0,1}, not both 0. */
export function canStepLocal(flags: FlagsAt, lx: number, lz: number, dx: number, dz: number): boolean {
    const nx = lx + dx;
    const nz = lz + dz;
    if (dx === 0 && dz === 0) {
        return false;
    }
    if (dx === 0 || dz === 0) {
        // cardinal — mirrors Client.ts:5681/5690/5699/5708
        if (dx === -1) return open(flags, nx, nz, CollisionFlag.PL_WALK_E);
        if (dx === 1) return open(flags, nx, nz, CollisionFlag.PL_WALK_W);
        if (dz === -1) return open(flags, nx, nz, CollisionFlag.PL_WALK_N);
        return open(flags, nx, nz, CollisionFlag.PL_WALK_S);
    }
    // diagonal — mirrors Client.ts:5716-5770: diagonal mask + both cardinals
    if (dx === -1 && dz === -1) {
        return open(flags, nx, nz, CollisionFlag.PL_WALK_NE) && canStepLocal(flags, lx, lz, -1, 0) && canStepLocal(flags, lx, lz, 0, -1);
    }
    if (dx === 1 && dz === -1) {
        return open(flags, nx, nz, CollisionFlag.PL_WALK_NW) && canStepLocal(flags, lx, lz, 1, 0) && canStepLocal(flags, lx, lz, 0, -1);
    }
    if (dx === -1 && dz === 1) {
        return open(flags, nx, nz, CollisionFlag.PL_WALK_SE) && canStepLocal(flags, lx, lz, -1, 0) && canStepLocal(flags, lx, lz, 0, 1);
    }
    return open(flags, nx, nz, CollisionFlag.PL_WALK_SW) && canStepLocal(flags, lx, lz, 1, 0) && canStepLocal(flags, lx, lz, 0, 1);
}

const DIRS: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
];

/** Check if we can reach adjacent to (nx, nz) by checking only walls, not WALK_SCENERY.
 *  Used for adjacentOk targets (e.g., NPCs on blocked tiles). */
function canReachAdjacentTile(flags: FlagsAt, nx: number, nz: number, dx: number, dz: number): boolean {
    const f = flags(nx, nz);
    if (f === null) {
        return false;
    }
    // Check for walls only, not WALK_SCENERY or other blocking flags
    // Extract just the wall bits from what PL_WALK_* would check
    let wallMask = 0;
    if (dx === -1 && dz === 0) {
        wallMask = CollisionFlag.W_E; // stepping west
    } else if (dx === 1 && dz === 0) {
        wallMask = CollisionFlag.W_W; // stepping east
    } else if (dx === 0 && dz === -1) {
        wallMask = CollisionFlag.W_N; // stepping north
    } else if (dx === 0 && dz === 1) {
        wallMask = CollisionFlag.W_S; // stepping south
    } else if (dx === -1 && dz === -1) {
        wallMask = CollisionFlag.W_NE | CollisionFlag.W_N | CollisionFlag.W_E; // stepping NW
    } else if (dx === 1 && dz === -1) {
        wallMask = CollisionFlag.W_NW | CollisionFlag.W_N | CollisionFlag.W_W; // stepping NE
    } else if (dx === -1 && dz === 1) {
        wallMask = CollisionFlag.W_SE | CollisionFlag.W_S | CollisionFlag.W_E; // stepping SW
    } else if (dx === 1 && dz === 1) {
        wallMask = CollisionFlag.W_SW | CollisionFlag.W_S | CollisionFlag.W_W; // stepping SE
    }
    return (f & wallMask) === 0;
}

/** Bounded BFS from `from` toward `to`. Unreachable/out-of-scene ⇒ false, never throws. */
export function canReachLocal(flags: FlagsAt, from: LocalPoint, to: LocalPoint, opts?: ReachOptions): boolean {
    const maxSteps = opts?.maxSteps ?? DEFAULT_MAX_STEPS;
    const adjacentOk = opts?.adjacentOk ?? false;
    if (flags(from.lx, from.lz) === null) {
        return false;
    }

    const key = (lx: number, lz: number): number => lx * 256 + lz;
    const seen = new Set<number>([key(from.lx, from.lz)]);
    const queue: LocalPoint[] = [from];
    let expansions = 0;

    while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur.lx === to.lx && cur.lz === to.lz) {
            return true;
        }
        if (adjacentOk && Math.abs(cur.lx - to.lx) + Math.abs(cur.lz - to.lz) === 1 && canReachAdjacentTile(flags, to.lx, to.lz, to.lx - cur.lx, to.lz - cur.lz)) {
            return true;
        }
        if (++expansions > maxSteps) {
            return false;
        }
        for (const [dx, dz] of DIRS) {
            const k = key(cur.lx + dx, cur.lz + dz);
            if (!seen.has(k) && canStepLocal(flags, cur.lx, cur.lz, dx, dz)) {
                seen.add(k);
                queue.push({ lx: cur.lx + dx, lz: cur.lz + dz });
            }
        }
    }
    return false;
}
