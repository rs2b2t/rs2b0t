// Pure geometry for WalkExecutor's click-and-commit loop. Kept free of
// client imports so the switchback behaviour is unit-testable.

export interface PathTileLike {
    x: number;
    z: number;
    level: number;
}

const cheb = (a: PathTileLike, b: PathTileLike): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Largest index i in [fromIdx, fromIdx+window) with tiles[i] on the player's
 * level and within `corridor` Chebyshev of `me`; -1 when the player is off
 * the corridor entirely (caller counts strikes before repathing).
 */
export function locateOnPath(tiles: PathTileLike[], me: PathTileLike, fromIdx: number, window: number, corridor: number): number {
    let found = -1;
    for (let i = fromIdx; i < Math.min(fromIdx + window, tiles.length); i++) {
        if (tiles[i].level === me.level && cheb(tiles[i], me) <= corridor) {
            found = i;
        }
    }
    return found;
}

/**
 * The click target `steps` ALONG THE PATH from pathIdx (never past limitIdx),
 * pulled back toward the player until `isClickable` accepts it (in scene +
 * reachable). Index-based selection is what fixes switchback oscillation: a
 * tile 20 walking-steps away is chosen even when the straight-line distance
 * to a later path tile is shorter. -1 when nothing ahead is clickable.
 */
export function selectClickTarget(tiles: PathTileLike[], pathIdx: number, steps: number, limitIdx: number, level: number, isClickable: (t: PathTileLike) => boolean): number {
    const top = Math.min(pathIdx + steps, limitIdx, tiles.length - 1);
    for (let i = top; i > pathIdx; i--) {
        if (tiles[i].level !== level) {
            continue;
        }
        if (isClickable(tiles[i])) {
            return i;
        }
    }
    return -1;
}
