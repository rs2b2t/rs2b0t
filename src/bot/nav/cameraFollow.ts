/**
 * Optional orbit-camera path facing (client-only — no server/LC changes).
 *
 * Uses the same yaw math as the client's cinema look-at:
 *   yaw = (atan2(dx, dz) * -325.949) & 0x7ff
 * so the view looks along the walk path the way a human arrow-key rotates.
 */

/** Scene-unit / tile delta → orbit camera yaw (0–2047). */
export function yawTowardDelta(dx: number, dz: number): number {
    if (dx === 0 && dz === 0) {
        return 0;
    }
    return ((Math.atan2(dx, dz) * -325.949) | 0) & 0x7ff;
}

/** Shortest signed yaw delta in (-1024, 1024]. */
export function yawDelta(from: number, to: number): number {
    let d = (to - from) & 0x7ff;
    if (d > 1024) {
        d -= 2048;
    }
    return d;
}

/** Step current yaw toward target by at most maxStep units (smooth human-ish turn). */
export function stepYaw(current: number, target: number, maxStep: number): number {
    if (maxStep <= 0) {
        return target & 0x7ff;
    }
    const d = yawDelta(current, target);
    if (d > maxStep) {
        return (current + maxStep) & 0x7ff;
    }
    if (d < -maxStep) {
        return (current - maxStep) & 0x7ff;
    }
    return target & 0x7ff;
}

export interface TileLike {
    x: number;
    z: number;
    level?: number;
}

/**
 * Pick a look-ahead tile on the path so the camera tracks the route, not every
 * single footstep (less twitchy on diagonals / switchbacks).
 */
export function lookAheadTile(
    tiles: TileLike[],
    pathIdx: number,
    lookAhead = 8
): TileLike | null {
    if (tiles.length === 0) {
        return null;
    }
    const i = Math.min(tiles.length - 1, Math.max(0, pathIdx) + Math.max(1, lookAhead));
    return tiles[i] ?? null;
}

/**
 * Desired orbit yaw so the camera faces from `from` toward `to` (same level only).
 * Returns null when there is no horizontal direction (same tile / level hop).
 */
export function yawTowardTiles(from: TileLike, to: TileLike): number | null {
    if (from.level !== undefined && to.level !== undefined && from.level !== to.level) {
        return null;
    }
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    if (dx === 0 && dz === 0) {
        return null;
    }
    return yawTowardDelta(dx, dz);
}
