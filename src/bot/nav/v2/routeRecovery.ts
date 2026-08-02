/**
 * Pure forward recovery (Microbot RouteRecovery idea).
 * On stall, prefer the furthest clickable tile ahead on the same path chain
 * instead of immediately repathing.
 */

import { chebyshev, type PathTileLike } from '../followMath.js';

/**
 * Furthest index in [fromIdx+1, limitIdx] that is on the same level, within
 * corridor of `me` **or** clickable, preferring the highest index that is
 * clickable and not behind the player on the path.
 *
 * Returns -1 when nothing usable is found (caller should repath / door scan).
 */
export function findForwardRecoveryIndex(
    tiles: PathTileLike[],
    me: PathTileLike,
    fromIdx: number,
    isClickable: (t: PathTileLike) => boolean,
    opts?: { corridor?: number; window?: number; limitIdx?: number }
): number {
    if (tiles.length === 0) {
        return -1;
    }
    const corridor = opts?.corridor ?? 3;
    const window = opts?.window ?? 40;
    const limitIdx = Math.min(opts?.limitIdx ?? tiles.length - 1, tiles.length - 1);
    const hi = Math.min(fromIdx + window, limitIdx);

    let bestClickable = -1;
    let bestOnCorridor = -1;
    for (let i = fromIdx + 1; i <= hi; i++) {
        const t = tiles[i]!;
        if (t.level !== me.level) {
            continue;
        }
        // Prefer tiles still ahead: not the tile we're standing on.
        if (t.x === me.x && t.z === me.z) {
            continue;
        }
        if (chebyshev(me, t) <= corridor) {
            bestOnCorridor = i;
        }
        if (isClickable(t)) {
            bestClickable = i;
        }
    }
    // Furthest clickable wins; else furthest corridor tile to re-anchor.
    if (bestClickable !== -1) {
        return bestClickable;
    }
    return bestOnCorridor;
}
