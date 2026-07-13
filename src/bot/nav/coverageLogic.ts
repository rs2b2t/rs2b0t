import type { NavPoint } from '#/bot/nav/PathFinder.js';

/**
 * Pure coverage classification for nav-target tiles (client-free → runs under
 * plain `bun test`). Injected `ReachChecker` so the logic is testable against a
 * synthetic world; the real tool wraps a `PathFinder` (walkable = exact-tile
 * walkability, connected = findPath(tile, anchor).ok, which uses the exact tile
 * as the start because PathFinder snaps a walkable start to itself).
 */
export interface ReachChecker {
    walkable(x: number, z: number, level: number): boolean;
    connected(from: NavPoint, anchor: NavPoint): boolean;
}

export type TargetKind = 'ok' | 'unwalkable' | 'island';

/** A nav-target is `unwalkable` (not a floor tile), an `island` (walkable but
 *  cannot reach the anchor — a sealed nook/pocket), or `ok`. */
export function classifyTarget(rc: ReachChecker, target: NavPoint, anchor: NavPoint): TargetKind {
    if (!rc.walkable(target.x, target.z, target.level)) {
        return 'unwalkable';
    }
    if (!rc.connected(target, anchor)) {
        return 'island';
    }
    return 'ok';
}

/** Nearest walkable tile (Chebyshev rings outward from `tile`, up to `maxRing`)
 *  that IS connected to the anchor — the suggested replacement for a flagged
 *  tile. Same level as `tile`. Null if none within `maxRing`. */
export function nearestConnected(rc: ReachChecker, tile: NavPoint, anchor: NavPoint, maxRing: number): NavPoint | null {
    for (let r = 1; r <= maxRing; r++) {
        for (let dx = -r; dx <= r; dx++) {
            for (let dz = -r; dz <= r; dz++) {
                if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) {
                    continue;
                }
                const c: NavPoint = { x: tile.x + dx, z: tile.z + dz, level: tile.level };
                if (rc.walkable(c.x, c.z, c.level) && rc.connected(c, anchor)) {
                    return c;
                }
            }
        }
    }
    return null;
}
