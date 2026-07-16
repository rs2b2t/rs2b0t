// Pure geometry for WalkExecutor's click-and-commit loop. Kept free of
// client imports so the switchback behaviour is unit-testable.

export interface PathTileLike {
    x: number;
    z: number;
    level: number;
}

export const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/**
 * Strictly on the far side of a crossing: closer to the far tile (step) than
 * to the near approach tile. approach and step are coordinate-adjacent (a
 * 1-tile door hop), so a plain proximity check to step would read true while
 * still standing on approach; this relative check only trips once the player
 * has actually moved across.
 */
export function isOnFarSide(me: PathTileLike | null, approach: PathTileLike, step: PathTileLike): boolean {
    return me !== null && me.level === step.level && chebyshev(me, step) < chebyshev(me, approach);
}

/**
 * Largest index i in [fromIdx, fromIdx+window) with tiles[i] on the player's
 * level and within `corridor` Chebyshev of `me`; -1 when the player is off
 * the corridor entirely (caller counts strikes before repathing).
 */
export function locateOnPath(tiles: PathTileLike[], me: PathTileLike, fromIdx: number, window: number, corridor: number): number {
    let found = -1;
    for (let i = fromIdx; i < Math.min(fromIdx + window, tiles.length); i++) {
        if (tiles[i].level === me.level && chebyshev(tiles[i], me) <= corridor) {
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

/**
 * Should followPath hand this crossing to handleTransport yet? Proximity alone
 * (the old rule) is wall-blind: a baked stair edge whose operate tile sits just
 * INSIDE a house wall came within trigger range of a bot walking past OUTSIDE,
 * and the resulting through-the-wall ladder click could never resolve ("I
 * can't reach that!" → two 8s waits → the ladder blacklisted → repath →
 * forever). `reachable` (live-collision canReach with adjacentOk, injected)
 * must accept the approach tile too — adjacentOk so a swung-open door leaf
 * FLAGGING the approach tile (shape-9 diagonal doors) still fires. Checked
 * last so the BFS only runs when proximate.
 */
export function crossingEligible(me: PathTileLike, approach: PathTileLike, far: PathTileLike, trigger: number, reachable: (t: PathTileLike) => boolean): boolean {
    if (me.level !== approach.level) {
        return false;
    }
    if (chebyshev(me, approach) > trigger && chebyshev(me, far) > trigger) {
        return false;
    }
    return reachable(approach);
}
