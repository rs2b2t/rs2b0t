/**
 * Expand pack waypoints into a dense tile list for paint / corridor snap.
 *
 * **Explore (not production-proven):** when both endpoints of a same-level segment
 * are in the live scene, fill with flag-aware BFS (`canStepLocal`) so the painted
 * polyline can match `Client.tryMove` more closely than Chebyshev diagonals.
 *
 * Falls back to Chebyshev when scene flags are unavailable, ends differ by level,
 * transport hops, or BFS fails / exceeds budget.
 */

import { canStepLocal, type FlagsAt, type LocalPoint } from './localReach.js';

export interface ExpandTile {
    x: number;
    z: number;
    level: number;
    transport?: unknown;
}

export interface ExpandWorldFns {
    /** World tile → scene local; null if off-scene. */
    toLocal: (x: number, z: number) => LocalPoint | null;
    /** Scene collision flags at local tile (null if out of bounds). */
    flags: FlagsAt;
    /** Cap BFS expansions (default 800). */
    maxBfsSteps?: number;
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

/** Classic expand: diagonal Chebyshev steps (pack paint historically). */
export function expandChebyshevSegment(
    prev: { x: number; z: number; level: number },
    next: { x: number; z: number; level: number }
): { x: number; z: number; level: number }[] {
    const dx = Math.sign(next.x - prev.x);
    const dz = Math.sign(next.z - prev.z);
    const steps = Math.max(Math.abs(next.x - prev.x), Math.abs(next.z - prev.z));
    const out: { x: number; z: number; level: number }[] = [];
    for (let step = 1; step <= steps; step++) {
        out.push({ x: prev.x + dx * step, z: prev.z + dz * step, level: next.level });
    }
    return out;
}

/**
 * Scene-local BFS path from→to (inclusive). Uses the same step rules as
 * `canStepLocal` / client walk flags. Returns null if unreachable within budget.
 */
export function localBfsPath(
    flags: FlagsAt,
    from: LocalPoint,
    to: LocalPoint,
    maxSteps = 800
): LocalPoint[] | null {
    if (from.lx === to.lx && from.lz === to.lz) {
        return [from];
    }
    if (flags(from.lx, from.lz) === null || flags(to.lx, to.lz) === null) {
        return null;
    }

    const key = (lx: number, lz: number): number => (lx << 16) | (lz & 0xffff);
    const parent = new Map<number, number>(); // childKey → parentKey
    const queue: LocalPoint[] = [from];
    const seen = new Set<number>([key(from.lx, from.lz)]);
    let expansions = 0;
    let found = false;

    while (queue.length > 0 && expansions < maxSteps) {
        const cur = queue.shift()!;
        expansions++;
        if (cur.lx === to.lx && cur.lz === to.lz) {
            found = true;
            break;
        }
        for (const [dx, dz] of DIRS) {
            if (!canStepLocal(flags, cur.lx, cur.lz, dx, dz)) {
                continue;
            }
            const nx = cur.lx + dx;
            const nz = cur.lz + dz;
            const nk = key(nx, nz);
            if (seen.has(nk)) {
                continue;
            }
            seen.add(nk);
            parent.set(nk, key(cur.lx, cur.lz));
            queue.push({ lx: nx, lz: nz });
        }
    }

    if (!found) {
        return null;
    }

    // Reconstruct from → to
    const rev: LocalPoint[] = [];
    let cx = to.lx;
    let cz = to.lz;
    const startK = key(from.lx, from.lz);
    let guard = 0;
    while (guard++ < maxSteps + 2) {
        rev.push({ lx: cx, lz: cz });
        const ck = key(cx, cz);
        if (ck === startK) {
            break;
        }
        const pk = parent.get(ck);
        if (pk === undefined) {
            return null;
        }
        cx = (pk >>> 16) & 0xffff;
        cz = pk & 0xffff;
    }
    rev.reverse();
    if (rev.length === 0 || rev[0]!.lx !== from.lx || rev[0]!.lz !== from.lz) {
        return null;
    }
    return rev;
}

/**
 * Expand one same-level non-transport segment. Prefer scene BFS when both ends
 * are local; else Chebyshev. Returned tiles exclude `prev` (caller already has it).
 */
export function expandSegment(
    prev: { x: number; z: number; level: number },
    next: { x: number; z: number; level: number },
    scene?: ExpandWorldFns | null
): { x: number; z: number; level: number }[] {
    if (prev.level !== next.level) {
        return [{ x: next.x, z: next.z, level: next.level }];
    }
    if (prev.x === next.x && prev.z === next.z) {
        return [];
    }

    if (scene) {
        const a = scene.toLocal(prev.x, prev.z);
        const b = scene.toLocal(next.x, next.z);
        if (a && b) {
            const path = localBfsPath(scene.flags, a, b, scene.maxBfsSteps ?? 800);
            if (path && path.length >= 2) {
                // Drop start (prev); map local → world via delta from known world prev
                // Local is scene-relative; world = prev + (local - a)
                const out: { x: number; z: number; level: number }[] = [];
                for (let i = 1; i < path.length; i++) {
                    const p = path[i]!;
                    out.push({
                        x: prev.x + (p.lx - a.lx),
                        z: prev.z + (p.lz - a.lz),
                        level: next.level
                    });
                }
                // Ensure we end on next (tryNearest / rounding)
                const last = out[out.length - 1]!;
                if (last.x !== next.x || last.z !== next.z) {
                    out.push({ x: next.x, z: next.z, level: next.level });
                }
                return out;
            }
        }
    }

    return expandChebyshevSegment(prev, next);
}

/**
 * Drop tiles already behind the player on an ordered path (for continuous trail paint).
 * Finds the closest path index to `me` and returns that tile forward.
 */
export function remainingPathFromPlayer<T extends { x: number; z: number; level: number }>(
    path: readonly T[],
    me: { x: number; z: number; level: number }
): T[] {
    if (path.length === 0) {
        return [];
    }
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < path.length; i++) {
        const t = path[i]!;
        if (t.level !== me.level) {
            continue;
        }
        const d = Math.max(Math.abs(t.x - me.x), Math.abs(t.z - me.z));
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return path.slice(best) as T[];
}

/**
 * Full waypoint expand (transport / level change = single tile, no interpolate).
 */
export function expandWaypoints<T extends ExpandTile>(
    waypoints: readonly T[],
    scene?: ExpandWorldFns | null
): T[] {
    const tiles: T[] = [];
    for (let i = 0; i < waypoints.length; i++) {
        const wp = waypoints[i]!;
        if (i === 0) {
            tiles.push({ ...wp });
            continue;
        }
        const prev = waypoints[i - 1]!;
        if (wp.transport || wp.level !== prev.level) {
            tiles.push({ ...wp });
            continue;
        }
        const filled = expandSegment(prev, wp, scene);
        for (const t of filled) {
            // Last step of segment may carry transport metadata from waypoint
            if (t.x === wp.x && t.z === wp.z && t.level === wp.level) {
                tiles.push({ ...wp });
            } else {
                tiles.push({ x: t.x, z: t.z, level: t.level } as T);
            }
        }
    }
    return tiles;
}
