// docs/decisions/corridor-snap.md
export interface PathTileLike {
    x: number;
    z: number;
    level: number;
}

export const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export function isOnFarSide(me: PathTileLike | null, approach: PathTileLike, step: PathTileLike): boolean {
    return me !== null && me.level === step.level && chebyshev(me, step) < chebyshev(me, approach);
}

export function locateOnPath(tiles: PathTileLike[], me: PathTileLike, fromIdx: number, window: number, corridor: number, limitIdx = tiles.length - 1): number {
    let found = -1;
    for (let i = fromIdx; i < Math.min(fromIdx + window, tiles.length, limitIdx + 1); i++) {
        if (tiles[i].level === me.level && chebyshev(tiles[i], me) <= corridor) {
            found = i;
        }
    }
    return found;
}

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

// Why: the scan runs far→near so a failed `tryMove` falls back to a closer path tile instead of waiting for stall ticks.
// Why: `tryWalk(i)` issues the client walk for tiles[i] and returns whether the client accepted a route (`tryMove` / `driver.walk`); its side effects are intended, since the caller uses the returned index as clickIdx.

/** Pick the furthest click the client walk/pathfind accepts. */
export function selectClientWalkTarget(
    tiles: PathTileLike[],
    pathIdx: number,
    steps: number,
    limitIdx: number,
    level: number,
    isClickable: (t: PathTileLike) => boolean,
    tryWalk: (tileIndex: number) => boolean
): number {
    const top = Math.min(pathIdx + steps, limitIdx, tiles.length - 1);
    for (let i = top; i > pathIdx; i--) {
        if (tiles[i].level !== level) {
            continue;
        }
        if (!isClickable(tiles[i])) {
            continue;
        }
        if (tryWalk(i)) {
            return i;
        }
    }
    return -1;
}

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

// Why: only the approach tile counts — proximity to the far landing, or to a nearby unrelated transport of the same type, must not snap the walker off the route.

/** Whether to execute a planned hop on the published path. */
export function crossingEligible(
    me: PathTileLike,
    approach: PathTileLike,
    _far: PathTileLike,
    trigger: number,
    reachable: (t: PathTileLike) => boolean
): boolean {
    if (me.level !== approach.level) {
        return false;
    }
    if (chebyshev(me, approach) > trigger) {
        return false;
    }
    return reachable(approach);
}

/** Min Chebyshev from `me` to any same-level path tile in [fromIdx, fromIdx+window]. */
export function minChebyshevToPath(
    tiles: PathTileLike[],
    me: PathTileLike,
    fromIdx: number,
    window: number,
    limitIdx = tiles.length - 1
): number {
    if (tiles.length === 0) {
        return Number.POSITIVE_INFINITY;
    }
    const lo = Math.max(0, fromIdx);
    const hi = Math.min(tiles.length - 1, limitIdx, fromIdx + window);
    let best = Number.POSITIVE_INFINITY;
    for (let i = lo; i <= hi; i++) {
        const t = tiles[i]!;
        if (t.level !== me.level) {
            continue;
        }
        const d = chebyshev(me, t);
        if (d < best) {
            best = d;
        }
    }
    return best;
}

export function chooseCrossClick(canStepEdge: boolean, canReachLanding: boolean): 'step' | 'landing-click' | 'landing-scene' {
    if (canStepEdge) {
        return 'step';
    }
    return canReachLanding ? 'landing-click' : 'landing-scene';
}

export function shouldApproachClosedBarrier(me: PathTileLike | null, approach: PathTileLike, closed: boolean): boolean {
    return closed && me !== null && (me.x !== approach.x || me.z !== approach.z || me.level !== approach.level);
}
