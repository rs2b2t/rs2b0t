import { CollisionFlag } from '#/dash3d/CollisionFlag.js';

export type FlagsAt = (lx: number, lz: number) => number | null;

export interface LocalPoint {
    lx: number;
    lz: number;
}

export interface ReachOptions {
    maxSteps?: number;
    adjacentOk?: boolean;
}

const DEFAULT_MAX_STEPS = 400;

function open(flags: FlagsAt, lx: number, lz: number, mask: number): boolean {
    const f = flags(lx, lz);
    return f !== null && (f & mask) === CollisionFlag._OPEN;
}

export function canStepLocal(flags: FlagsAt, lx: number, lz: number, dx: number, dz: number): boolean {
    const nx = lx + dx;
    const nz = lz + dz;
    if (dx === 0 && dz === 0) {
        return false;
    }
    if (dx === 0 || dz === 0) {
        if (dx === -1) return open(flags, nx, nz, CollisionFlag.PL_WALK_E);
        if (dx === 1) return open(flags, nx, nz, CollisionFlag.PL_WALK_W);
        if (dz === -1) return open(flags, nx, nz, CollisionFlag.PL_WALK_N);
        return open(flags, nx, nz, CollisionFlag.PL_WALK_S);
    }
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

function canReachAdjacentTile(flags: FlagsAt, nx: number, nz: number, dx: number, dz: number): boolean {
    const f = flags(nx, nz);
    if (f === null) {
        return false;
    }
    let wallMask = 0;
    if (dx === -1 && dz === 0) {
        wallMask = CollisionFlag.W_E;
    } else if (dx === 1 && dz === 0) {
        wallMask = CollisionFlag.W_W;
    } else if (dx === 0 && dz === -1) {
        wallMask = CollisionFlag.W_N;
    } else if (dx === 0 && dz === 1) {
        wallMask = CollisionFlag.W_S;
    } else if (dx === -1 && dz === -1) {
        wallMask = CollisionFlag.W_NE | CollisionFlag.W_N | CollisionFlag.W_E;
    } else if (dx === 1 && dz === -1) {
        wallMask = CollisionFlag.W_NW | CollisionFlag.W_N | CollisionFlag.W_W;
    } else if (dx === -1 && dz === 1) {
        wallMask = CollisionFlag.W_SE | CollisionFlag.W_S | CollisionFlag.W_E;
    } else if (dx === 1 && dz === 1) {
        wallMask = CollisionFlag.W_SW | CollisionFlag.W_S | CollisionFlag.W_W;
    }
    return (f & wallMask) === 0;
}

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
