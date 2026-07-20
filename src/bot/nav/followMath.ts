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
 * Last-mile rescue for a starved click selection. locateOnPath snaps pathIdx
 * to the TERMINAL index from `corridor` tiles out, and selectClickTarget's
 * strict `i > pathIdx` then has nothing left to select — so a short hop
 * (any path whose terminal is within the corridor of the player) never
 * clicks at all: 0 clicks, then a bogus "blocked live" at cheb 1 or a
 * repath-to-timeout loop at cheb 2-3. When the ordinary selection starves
 * and no crossing is pending (the caller checks — crossing starvation
 * belongs to the transport fallback), the terminal itself is the click:
 * returns its index when it's on the player's level, not under the player
 * (standing on it is arrival), and clickable; -1 otherwise so a genuinely
 * blocked terminal still earns the honest 'blocked' verdict.
 */
export function starvedTerminalIndex(tiles: PathTileLike[], me: PathTileLike, isClickable: (t: PathTileLike) => boolean): number {
    const last = tiles.length - 1;
    if (last < 0) {
        return -1;
    }
    const end = tiles[last];
    if (end.level !== me.level || (end.x === me.x && end.z === me.z)) {
        return -1;
    }
    return isClickable(end) ? last : -1;
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

/**
 * Which through-move a door crossing should make once the leaf reads open.
 * `canStepEdge` is the RAW one-edge collision check approach→step (precise,
 * cheap — the exact same rule the client's tryMove uses); when it is open, walk
 * ONTO the far tile itself. The old flow aimed only at `landing` (one tile PAST
 * the door), which in tight interiors can be furniture/wall — the witch-house
 * inner door — so the cross timed out with the edge genuinely open. The two
 * landing modes are the preserved shape-9 swung-leaf handling: a gated click
 * when a bypass route exists, a raw scene-step when the leaf seals the gap.
 */
export function chooseCrossClick(canStepEdge: boolean, canReachLanding: boolean): 'step' | 'landing-click' | 'landing-scene' {
    if (canStepEdge) {
        return 'step';
    }
    return canReachLanding ? 'landing-click' : 'landing-scene';
}
