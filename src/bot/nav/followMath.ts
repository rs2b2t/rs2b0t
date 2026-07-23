export interface PathTileLike {
    x: number;
    z: number;
    level: number;
}

export const chebyshev = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

export function isOnFarSide(me: PathTileLike | null, approach: PathTileLike, step: PathTileLike): boolean {
    return me !== null && me.level === step.level && chebyshev(me, step) < chebyshev(me, approach);
}

export function locateOnPath(tiles: PathTileLike[], me: PathTileLike, fromIdx: number, window: number, corridor: number): number {
    let found = -1;
    for (let i = fromIdx; i < Math.min(fromIdx + window, tiles.length); i++) {
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

export function crossingEligible(me: PathTileLike, approach: PathTileLike, far: PathTileLike, trigger: number, reachable: (t: PathTileLike) => boolean): boolean {
    if (me.level !== approach.level) {
        return false;
    }
    if (chebyshev(me, approach) > trigger && chebyshev(me, far) > trigger) {
        return false;
    }
    return reachable(approach);
}

export function chooseCrossClick(canStepEdge: boolean, canReachLanding: boolean): 'step' | 'landing-click' | 'landing-scene' {
    if (canStepEdge) {
        return 'step';
    }
    return canReachLanding ? 'landing-click' : 'landing-scene';
}
